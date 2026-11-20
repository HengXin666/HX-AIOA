import {
  PING_TEXT,
  PONG_TEXT,
  QUERY_DEVICE,
  QUERY_SINCE,
  QUERY_TOKEN,
  WS_PATH,
  type Body,
  type ClientFrame,
  type MsgFrame,
  type ServerFrame,
} from "@hx-aioa/protocol";
import { HEARTBEAT_MS, RECONNECT_MAX_MS, RECONNECT_MIN_MS } from "./constants";

export type LinkEvents = {
  onMessage: (frame: MsgFrame) => void;
  onStatus: (online: boolean) => void;
};

export type LinkOptions = {
  server: string;
  token: string;
  device: string;
  since: () => number;
};

// 单条 WebSocket, 指数退避重连, 重连时带 since 补拉
export class Link {
  private ws: WebSocket | null = null;
  private retry = RECONNECT_MIN_MS;
  private heartbeat: number | undefined;

  constructor(
    private readonly opts: LinkOptions,
    private readonly events: LinkEvents,
  ) {}

  start(): void {
    this.connect();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && !this.isOpen()) this.connect();
    });
    window.addEventListener("online", () => this.connect());
  }

  send(cid: string, body: Body): boolean {
    return this.write({ t: "send", cid, body });
  }

  private connect(): void {
    this.ws?.close();
    const url = new URL(WS_PATH, this.opts.server.replace(/^http/, "ws"));
    url.searchParams.set(QUERY_TOKEN, this.opts.token);
    url.searchParams.set(QUERY_DEVICE, this.opts.device);
    url.searchParams.set(QUERY_SINCE, String(this.opts.since()));
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = RECONNECT_MIN_MS;
      this.events.onStatus(true);
      this.startHeartbeat();
    };
    ws.onmessage = (e) => this.onData(String(e.data));
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.events.onStatus(false);
      this.stopHeartbeat();
      setTimeout(() => this.connect(), this.retry);
      this.retry = Math.min(this.retry * 2, RECONNECT_MAX_MS);
    };
  }

  private onData(text: string): void {
    if (text === PONG_TEXT) return;
    const frame = JSON.parse(text) as ServerFrame;
    if (frame.t === "msg") {
      this.events.onMessage(frame);
      this.write({ t: "ack", seq: frame.seq });
    } else if (frame.t === "err") {
      console.warn("服务端错误:", frame.code, frame.text);
    }
  }

  private write(frame: ClientFrame): boolean {
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
