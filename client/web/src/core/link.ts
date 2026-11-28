import {
  CLOSE_KICKED,
  CLOSE_REVOKED,
  PING_TEXT,
  PONG_TEXT,
  QUERY_DEVICE,
  QUERY_SINCE,
  QUERY_TOKEN,
  STREAM_PATH,
  type SendFrame,
} from "@hx-aioa/protocol";
import { accessToken, deviceId, signOutLocal } from "./auth";
import { HEARTBEAT_MS, RECONNECT_MAX_MS, RECONNECT_MIN_MS } from "./constants";
import { Emitter } from "./emitter";

export type LinkState = "idle" | "connecting" | "online" | "offline";
// 收到的帧只认 t, 具体字段由各 store 自己判断; 未知类型直接忽略 (向前兼容)
export type Frame = { t: string } & Record<string, unknown>;

// 一个页面一条连接; 页面隐藏且断线时不重连, 回到前台再连 (省 Worker 与 DO 请求)
class Link {
  readonly frames = new Emitter<Frame>();
  readonly states = new Emitter<LinkState>();
  state: LinkState = "idle";
  private ws: WebSocket | null = null;
  private retry = RECONNECT_MIN_MS;
  private timer: number | undefined;
  private beat: number | undefined;
  private since = 0;
  private running = false;
  private cid = 0;

  start(): void {
    if (this.running) return;
    this.running = true;
    document.addEventListener("visibilitychange", this.onVisible);
    window.addEventListener("online", this.onVisible);
    void this.connect();
  }

  stop(): void {
    this.running = false;
    document.removeEventListener("visibilitychange", this.onVisible);
    window.removeEventListener("online", this.onVisible);
    clearTimeout(this.timer);
    this.ws?.close();
    this.ws = null;
    this.set("idle");
  }

  // 已收到的最大 seq, 重连时补发它之后的事件
  seen(seq: number): void {
    if (seq > this.since) this.since = seq;
  }

  send(frame: Omit<SendFrame, "t" | "cid">): string | null {
    const cid = `w${Date.now().toString(36)}${(this.cid++).toString(36)}`;
    return this.write({ t: "send", cid, ...frame }) ? cid : null;
  }

  write(frame: object): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(frame));
    return true;
  }

  private readonly onVisible = (): void => {
    if (document.visibilityState === "visible" && this.running && !this.ws) {
      clearTimeout(this.timer);
      this.retry = RECONNECT_MIN_MS;
      void this.connect();
    }
  };

  private set(s: LinkState): void {
    if (this.state === s) return;
    this.state = s;
    this.states.emit(s);
  }

  private async connect(): Promise<void> {
    if (!this.running || this.ws) return;
    this.set("connecting");
    const token = await accessToken();
    if (!token) return this.set("offline");
    const url = new URL(STREAM_PATH, location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set(QUERY_TOKEN, token);
    url.searchParams.set(QUERY_DEVICE, deviceId());
    if (this.since > 0) url.searchParams.set(QUERY_SINCE, String(this.since));
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = RECONNECT_MIN_MS;
      this.set("online");
      clearInterval(this.beat);
      this.beat = window.setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(PING_TEXT), HEARTBEAT_MS);
    };
    ws.onmessage = (e) => {
      if (typeof e.data !== "string" || e.data === PONG_TEXT) return;
      try {
        const f = JSON.parse(e.data) as Frame;
        if (typeof f.t === "string") this.frames.emit(f);
      } catch {
        // 坏帧丢弃
      }
    };
    ws.onclose = (e) => {
      clearInterval(this.beat);
      if (this.ws === ws) this.ws = null;
      if (e.code === CLOSE_KICKED || e.code === CLOSE_REVOKED) {
        this.running = false;
        signOutLocal();
        return;
      }
      this.set("offline");
      this.schedule();
    };
  }

  private schedule(): void {
    if (!this.running || document.visibilityState !== "visible") return;
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.connect(), this.retry);
    this.retry = Math.min(this.retry * 2, RECONNECT_MAX_MS);
  }
}

export const link = new Link();
