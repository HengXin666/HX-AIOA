import {
  CLOSE_KICKED,
  CLOSE_REVOKED,
  PING_TEXT,
  PONG_TEXT,
  QUERY_DEVICE,
  QUERY_ROLE,
  QUERY_SINCE,
  QUERY_TOKEN,
  STREAM_PATH,
  type ClientFrame,
  type StreamClientFrame,
  type StreamServerFrame,
  type ServerFrame,
  type UserActionInput,
} from "@hx-aioa/protocol";
import { HEARTBEAT_MS, RECONNECT_MAX_MS, RECONNECT_MIN_MS } from "../constants";
import type { Backend } from "./backend";
import type { Store } from "./store";

type Incoming = StreamServerFrame | ServerFrame;
type Outgoing = StreamClientFrame | ClientFrame;

export type StreamOptions = {
  server: string;
  token: string;
  device: string;
  onSettings?: (s: Record<string, unknown>) => void;
};

// v1 流: 事件, 任务, 指标, 工作台都走这一条连接, 与旧 /ws 消息链路并存
export class StreamLink implements Backend {
  readonly mode = "live";
  private ws: WebSocket | null = null;
  private retry = RECONNECT_MIN_MS;
  private heartbeat: number | undefined;
  private since = 0;
  private watching: string[] = [];
  private stopped = false;

  constructor(
    private readonly opts: StreamOptions,
    private readonly store: Store,
  ) {}

  start(): void {
    this.connect();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && !this.isOpen()) this.connect();
    });
  }

  sendAct(input: UserActionInput): boolean {
    return this.write({ t: "act", ...input });
  }

  watch(subjects: string[]): void {
    this.watching = subjects;
    this.write({ t: "watch", subjects });
  }

  private connect(): void {
    if (this.stopped) return;
    this.ws?.close();
    const url = new URL(STREAM_PATH, this.opts.server.replace(/^http/, "ws"));
    url.searchParams.set(QUERY_TOKEN, this.opts.token);
    url.searchParams.set(QUERY_ROLE, "client");
    url.searchParams.set(QUERY_DEVICE, this.opts.device);
    url.searchParams.set(QUERY_SINCE, String(this.since));
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = RECONNECT_MIN_MS;
      this.store.setLink(true);
      this.startHeartbeat();
      this.write({ t: "overview" });
      if (this.watching.length) this.write({ t: "watch", subjects: this.watching });
    };
    ws.onmessage = (e) => this.onData(String(e.data));
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.stopHeartbeat();
      if (e.code === CLOSE_KICKED || e.code === CLOSE_REVOKED) {
        this.stopped = true;
        this.store.setLink(false, "登录已失效, 请重新登录");
        return;
      }
      this.store.setLink(false);
      setTimeout(() => this.connect(), this.retry);
      this.retry = Math.min(this.retry * 2, RECONNECT_MAX_MS);
    };
  }

  private onData(text: string): void {
    if (text === PONG_TEXT) return;
    let f: Incoming;
    try {
      f = JSON.parse(text) as Incoming;
    } catch {
      return;
    }
    const s = this.store;
    switch (f.t) {
      case "welcome":
        s.setReady(true);
        break;
      case "ev":
        this.since = Math.max(this.since, f.ev.seq);
        s.ingest(f.ev);
        break;
      case "task":
        s.ingestTask(f.task);
        break;
      case "metric":
        s.ingestPoints(f.subject, f.points);
        break;
      case "space_update":
        if (f.deleted) s.removeSpace(f.id);
        else if (f.space) s.upsertSpace(f.space);
        break;
      case "overview":
        s.overview = f.overview;
        f.overview.tasks.forEach((t) => s.ingestTask(t));
        Object.values(f.overview.layers).flat().forEach((it) => s.ingest(it.ev));
        break;
      case "settings":
        this.opts.onSettings?.(f.settings);
        break;
      case "err":
        console.warn("服务端错误:", f.code, f.text);
        break;
    }
  }

  private write(frame: Outgoing): boolean {
    if (!this.isOpen()) return false;
    this.ws!.send(JSON.stringify(frame));
    return true;
  }

  private isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeat = window.setInterval(() => {
      if (this.isOpen()) this.ws!.send(PING_TEXT);
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat !== undefined) window.clearInterval(this.heartbeat);
    this.heartbeat = undefined;
  }
}

export const offlineBackend: Backend = {
  mode: "none",
  sendAct: () => false,
  watch: () => undefined,
};
