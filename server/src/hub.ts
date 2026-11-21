import { DurableObject } from "cloudflare:workers";
import {
  ANDROID_DEVICE_PREFIX,
  PROBE_DEVICE_PREFIX,
  PING_TEXT,
  PONG_TEXT,
  QUERY_DEVICE,
  QUERY_SINCE,
  parseClientFrame,
  previewOf,
  type Body,
  type ClientFrame,
  type MsgFrame,
  type SendResult,
  type ServerFrame,
} from "@hx-aioa/protocol";
import {
  ERR_BAD_FRAME,
  ERR_NEED_WS,
  ERR_TOO_LONG,
  FALLBACK_DELAY_MS,
  HISTORY_MAX_LIMIT,
  KEY_ACKED_SEQ,
  KEY_PENDING_SEQ,
  KEY_PUSH_TOKEN,
  MAX_TEXT_LENGTH,
  ABNORMAL_CLOSE,
  NO_STATUS_CLOSE,
  NORMAL_CLOSE,
  UNKNOWN_DEVICE,
} from "./constants";
import type { Env } from "./env";
import { hasFallback, sendFallback } from "./notify";
import { type Attachment, MetricRouter, isProbe } from "./metrics";
import { MessageStore } from "./store";


// 单实例消息中枢, 只用休眠 API, 空闲时不计运行时长
export class Hub extends DurableObject<Env> {
  private readonly store: MessageStore;
  private readonly metrics: MetricRouter;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new MessageStore(ctx.storage.sql);
    this.metrics = new MetricRouter(() => this.ctx.getWebSockets());
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING_TEXT, PONG_TEXT));
  }

  override async fetch(req: Request): Promise<Response> {
    if (req.headers.get("Upgrade") !== "websocket") {
      return new Response(ERR_NEED_WS, { status: 426 });
    }
    const url = new URL(req.url);
    const device = url.searchParams.get(QUERY_DEVICE) || UNKNOWN_DEVICE;
    const since = Number(url.searchParams.get(QUERY_SINCE) ?? Number.NaN);

    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server, [device]);
    server.serializeAttachment({ device } satisfies Attachment);

    this.reply(server, { t: "welcome", head: this.store.head() });
    if (!device.startsWith(PROBE_DEVICE_PREFIX)) this.reply(server, this.metrics.probes());
    if (Number.isFinite(since)) {
      for (const frame of this.store.since(since, HISTORY_MAX_LIMIT)) this.reply(server, frame);
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    const frame = typeof data === "string" ? parseClientFrame(data) : null;
    if (!frame) {
      this.reply(ws, { t: "err", code: "bad_frame", text: ERR_BAD_FRAME });
      return;
    }
    await this.handle(ws, frame);
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    this.release(ws);
    // 1005 / 1006 是保留码, 不能用于主动关闭
    try {
      ws.close(code === ABNORMAL_CLOSE || code === NO_STATUS_CLOSE ? NORMAL_CLOSE : code, reason);
    } catch {
      // 已关闭
    }
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    this.release(ws);
  }

  private release(ws: WebSocket): void {
    ws.serializeAttachment({ device: (ws.deserializeAttachment() as Attachment).device, watch: [], offer: [] });
    this.metrics.rebalance();
  }

  override async alarm(): Promise<void> {
    const pending = (await this.ctx.storage.get<number>(KEY_PENDING_SEQ)) ?? 0;
    const acked = (await this.ctx.storage.get<number>(KEY_ACKED_SEQ)) ?? 0;
    await this.ctx.storage.delete(KEY_PENDING_SEQ);
    if (pending <= acked) return;

    const missed = this.store.since(acked, HISTORY_MAX_LIMIT);
    const last = missed[missed.length - 1];
    if (!last) return;
    await sendFallback(this.env, {
      preview: previewOf(last.body),
      count: missed.length,
      pushToken: await this.ctx.storage.get<string>(KEY_PUSH_TOKEN),
    });
  }

  async post(src: string, body: Body, cid?: string): Promise<SendResult> {
    if (body.text.length > MAX_TEXT_LENGTH) throw new Error(ERR_TOO_LONG);
    const ts = Date.now();
    const seq = this.store.append(src, body, cid, ts);
    const frame: MsgFrame = { t: "msg", seq, ts, src, body };
    if (cid) frame.cid = cid;
    this.broadcast(frame);
    if (!src.startsWith(ANDROID_DEVICE_PREFIX)) await this.armFallback(seq);
    return { seq, ts };
  }

  async history(since: number, limit: number): Promise<MsgFrame[]> {
    return this.store.since(since, limit);
  }

  private async handle(ws: WebSocket, frame: ClientFrame): Promise<void> {
    const att = ws.deserializeAttachment() as Attachment;
    const { device } = att;
    switch (frame.t) {
      case "watch":
        ws.serializeAttachment({ ...att, watch: frame.subjects } satisfies Attachment);
        this.metrics.primeWatcher(ws, frame.subjects.filter((s) => !(att.watch ?? []).includes(s)));
        this.metrics.rebalance();
        return;
      case "offer":
        if (!isProbe(att)) return;
        ws.serializeAttachment({ ...att, offer: frame.subjects, demand: [] } satisfies Attachment);
        this.metrics.rebalance();
        return;
      case "metric":
        if (isProbe(att) && (att.offer ?? []).includes(frame.subject)) this.metrics.relay(frame);
        return;
      case "send": {
        try {
          const r = await this.post(device, frame.body, frame.cid);
          this.reply(ws, { t: "sent", cid: frame.cid, seq: r.seq, ts: r.ts });
        } catch (e) {
          this.reply(ws, { t: "err", code: "send_failed", text: String(e) });
        }
        return;
      }
      case "ack":
        if (device.startsWith(ANDROID_DEVICE_PREFIX)) {
          await this.ctx.storage.put(KEY_ACKED_SEQ, frame.seq);
        }
        return;
      case "reg":
        await this.ctx.storage.put(KEY_PUSH_TOKEN, frame.pushToken);
        return;
    }
  }

  // 已有待触发的闹钟时只更新 pending, 合并多条消息为一次兜底推送
  private async armFallback(seq: number): Promise<void> {
    if (!hasFallback(this.env)) return;
    await this.ctx.storage.put(KEY_PENDING_SEQ, seq);
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + FALLBACK_DELAY_MS);
    }
  }

  private broadcast(frame: ServerFrame): void {
    const text = JSON.stringify(frame);
    for (const ws of this.ctx.getWebSockets()) {
      if (isProbe(ws.deserializeAttachment() as Attachment)) continue;
      try {
        ws.send(text);
      } catch {
        // 连接已失效, 由运行时回收
      }
    }
  }

  private reply(ws: WebSocket, frame: ServerFrame): void {
    ws.send(JSON.stringify(frame));
  }
}
