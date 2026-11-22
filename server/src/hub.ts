import { DurableObject } from "cloudflare:workers";
import {
  ANDROID_DEVICE_PREFIX,
  PING_TEXT,
  PONG_TEXT,
  PROBE_DEVICE_PREFIX,
  PROTOCOL_VERSION,
  QUERY_DEVICE,
  QUERY_ROLE,
  QUERY_SINCE,
  STREAM_PATH,
  STREAM_ROLES,
  parseClientFrame,
  parseStreamFrame,
  type ClientFrame,
  type StreamClientFrame,
  type StreamRole,
} from "@hx-aioa/protocol";
import { AgentService } from "./agents";
import { handleHttp, principalOf } from "./api";
import { messageInput } from "./api-events";
import { Config } from "./config";
import {
  ABNORMAL_CLOSE,
  CODE_BAD_REQUEST,
  CODE_FORBIDDEN,
  CODE_UNAUTHORIZED,
  ERR_BAD_FRAME,
  ERR_FORBIDDEN,
  ERR_UNAUTHORIZED,
  HISTORY_DEFAULT_LIMIT,
  HISTORY_MAX_LIMIT,
  KEY_ACKED_SEQ,
  KEY_PUSH_TOKEN,
  NORMAL_CLOSE,
  NO_STATUS_CLOSE,
  OVERVIEW_SCAN,
  OWNER_ID,
  PROTO_LEGACY,
  PROTO_V1,
  TIMER_AGG_PREFIX,
  TIMER_FALLBACK,
  TIMER_PROMPT_PREFIX,
  UNKNOWN_DEVICE,
} from "./constants";
import { type Core, type Principal, allowed } from "./core";
import type { Env } from "./env";
import { buildOverview } from "./group";
import { ApiFail, fail } from "./http";
import { toMsgFrame } from "./legacy";
import { MetricRouter, isProbe } from "./metrics";
import { Pipeline } from "./pipeline";
import { Registry } from "./registry";
import { type Attachment, Sockets, attOf, sendFrame } from "./sockets";
import { EventStore } from "./store";
import { Spaces } from "./spaces";
import { TaskStore } from "./taskstore";
import { Timers } from "./timers";

// 单实例消息中枢 (多账号落地后即每用户一个), 只用休眠 API, 空闲时不计运行时长
export class Hub extends DurableObject<Env> {
  private readonly core: Core;
  private readonly timers: Timers;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    const all = () => this.ctx.getWebSockets();
    const store = new EventStore(sql, (fn) => ctx.storage.transactionSync(fn));
    const config = new Config(ctx.storage);
    const metrics = new MetricRouter(all, sql);
    const sockets = new Sockets(all);
    this.timers = new Timers(ctx.storage);
    const pipeline = new Pipeline(env, ctx.storage, store, config, metrics, sockets, this.timers);
    const spaces = new Spaces(ctx.storage);
    const agents = new AgentService(new TaskStore(sql), sockets, pipeline, this.timers, spaces);
    this.core = { env, store, registry: new Registry(sql), config, pipeline, agents, metrics, sockets, spaces };
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING_TEXT, PONG_TEXT));
  }

  override async fetch(req: Request): Promise<Response> {
    if (req.headers.get("Upgrade") !== "websocket") return handleHttp(this.core, req);
    const url = new URL(req.url);
    const who = await principalOf(this.core, req, url);
    if (!who) return fail(401, ERR_UNAUTHORIZED, CODE_UNAUTHORIZED);
    const v1 = url.pathname === STREAM_PATH;
    const device = url.searchParams.get(QUERY_DEVICE) || UNKNOWN_DEVICE;
    const roleRaw = url.searchParams.get(QUERY_ROLE) ?? (device.startsWith(PROBE_DEVICE_PREFIX) ? "probe" : "client");
    const role = (STREAM_ROLES as readonly string[]).includes(roleRaw) ? (roleRaw as StreamRole) : null;
    if (!role || !this.mayConnect(who, role, device)) return fail(403, ERR_FORBIDDEN, CODE_FORBIDDEN);

    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server, [device]);
    const att: Attachment = { device, proto: v1 ? PROTO_V1 : PROTO_LEGACY, role };
    if (!who.owner) att.keyId = who.key.id;
    server.serializeAttachment(att);

    const head = this.core.store.head();
    if (v1) sendFrame(server, { t: "welcome", head, v: PROTOCOL_VERSION, now: Date.now(), role });
    else sendFrame(server, { t: "welcome", head });
    if (role !== "client") return new Response(null, { status: 101, webSocket: client });
    sendFrame(server, this.core.metrics.probes());
    if (v1) sendFrame(server, { t: "agents", agents: this.core.agents.statuses() });
    if (v1) for (const space of await this.core.spaces.list()) sendFrame(server, { t: "space_update", id: space.id, space });
    const since = Number(url.searchParams.get(QUERY_SINCE) ?? Number.NaN);
    if (Number.isFinite(since)) {
      for (const ev of this.core.store.since(since, HISTORY_MAX_LIMIT)) sendFrame(server, v1 ? { t: "ev", ev } : toMsgFrame(ev));
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  private mayConnect(who: Principal, role: StreamRole, device: string): boolean {
    if (role === "client") return who.owner;
    if (role === "agent") return allowed(who, "agent");
    if (!allowed(who, "probe") || !device.startsWith(PROBE_DEVICE_PREFIX)) return false;
    return who.owner || !who.key.subject || device === `${PROBE_DEVICE_PREFIX}-${who.key.subject}`;
  }

  override async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    if (typeof data !== "string") return void this.err(ws, CODE_BAD_REQUEST, ERR_BAD_FRAME);
    const att = attOf(ws);
    try {
      if (att.proto === PROTO_V1) {
        let obj: unknown;
        try {
          obj = JSON.parse(data);
        } catch {
          return void this.err(ws, CODE_BAD_REQUEST, ERR_BAD_FRAME);
        }
        const f = typeof obj === "object" && obj !== null ? parseStreamFrame(obj as Record<string, unknown>) : null;
        if (typeof f === "string") return void this.err(ws, CODE_BAD_REQUEST, f, (obj as { aid?: string }).aid);
        if (f) return await this.handleStream(ws, att, f);
      }
      const frame = parseClientFrame(data);
      if (!frame) return void this.err(ws, CODE_BAD_REQUEST, ERR_BAD_FRAME);
      await this.handleLegacy(ws, att, frame);
    } catch (e) {
      const aid = (() => {
        try {
          return (JSON.parse(data) as { aid?: string }).aid;
        } catch {
          return undefined;
        }
      })();
      if (e instanceof ApiFail) this.err(ws, e.code, e.message, aid);
      else this.err(ws, "internal", String(e), aid);
    }
  }

  private async handleStream(ws: WebSocket, att: Attachment, f: StreamClientFrame): Promise<void> {
    const agents = this.core.agents;
    const isAgent = att.role === "agent";
    if ((f.t === "task" || f.t === "agent_hello" || f.t === "act_ack") !== isAgent) return this.err(ws, CODE_FORBIDDEN, ERR_FORBIDDEN);
    switch (f.t) {
      case "act": {
        const { t: _t, ...input } = f;
        const r = await agents.act(input, OWNER_ID);
        sendFrame(ws, { t: "act_ok", ...r });
        return;
      }
      case "overview": {
        const overview = buildOverview(this.core.store.recent(OVERVIEW_SCAN), agents.list(null, HISTORY_DEFAULT_LIMIT), Date.now());
        sendFrame(ws, { t: "overview", overview });
        return;
      }
      case "task": {
        const { t: _t, ...op } = f;
        const fallback = att.agents?.length === 1 ? att.agents[0] : undefined;
        const task = await agents.op(op, fallback ? { keyId: att.keyId ?? null, agent: fallback } : { keyId: att.keyId ?? null });
        sendFrame(ws, { t: "task", task });
        return;
      }
      case "agent_hello":
        agents.hello(ws, f.agent);
        return;
      case "act_ack":
        agents.ack(f.aid, { keyId: att.keyId ?? null });
        return;
    }
  }

  private async handleLegacy(ws: WebSocket, att: Attachment, frame: ClientFrame): Promise<void> {
    const metrics = this.core.metrics;
    switch (frame.t) {
      case "watch":
        ws.serializeAttachment({ ...att, watch: frame.subjects } satisfies Attachment);
        metrics.primeWatcher(ws, frame.subjects.filter((s) => !(att.watch ?? []).includes(s)));
        metrics.rebalance();
        return;
      case "offer":
        if (!isProbe(att)) return;
        ws.serializeAttachment({ ...att, offer: frame.subjects, demand: [] } satisfies Attachment);
        metrics.rebalance();
        return;
      case "metric":
        if (isProbe(att) && (att.offer ?? []).includes(frame.subject)) metrics.relay(frame);
        return;
      case "send": {
        if (att.role !== "client") return;
        const input = messageInput({ text: frame.body.text });
        if (typeof input === "string") return this.err(ws, CODE_BAD_REQUEST, input);
        // 自己发给自己的备忘不响铃, 也不触发兜底推送
        const ev = await this.core.pipeline.fromInput(input, { source: { id: att.device, name: att.device }, cid: frame.cid }, { action: "silent", channels: ["ws"], reason: "本人发送" });
        sendFrame(ws, { t: "sent", cid: frame.cid, seq: ev.seq, ts: ev.ts });
        return;
      }
      case "ack":
        if (att.device.startsWith(ANDROID_DEVICE_PREFIX)) await this.ctx.storage.put(KEY_ACKED_SEQ, frame.seq);
        return;
      case "reg":
        if (att.role === "client") await this.ctx.storage.put(KEY_PUSH_TOKEN, frame.pushToken);
        return;
    }
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
    const att = attOf(ws);
    ws.serializeAttachment({ ...att, watch: [], offer: [], agents: [] } satisfies Attachment);
    this.core.metrics.rebalance();
    if (att.role === "agent") this.core.agents.broadcastAgents();
  }

  override async alarm(): Promise<void> {
    for (const name of await this.timers.takeDue(Date.now())) {
      try {
        if (name === TIMER_FALLBACK) await this.core.pipeline.runFallback();
        else if (name.startsWith(TIMER_AGG_PREFIX)) await this.core.pipeline.flushBucket(name.slice(TIMER_AGG_PREFIX.length));
        else if (name.startsWith(TIMER_PROMPT_PREFIX)) await this.core.agents.expire(name.slice(TIMER_PROMPT_PREFIX.length));
      } catch (e) {
        console.error("定时任务失败:", name, e);
      }
    }
  }

  private err(ws: WebSocket, code: string, text: string, aid?: string): void {
    sendFrame(ws, aid ? { t: "err", code, text, aid } : { t: "err", code, text });
  }
}
