import { CLOSE_KICKED, CLOSE_REVOKED, PING_TEXT, PONG_TEXT, QUERY_CLIENT, QUERY_CLIENT_BUILD, QUERY_DEVICE, QUERY_SINCE, QUERY_TOKEN, STREAM_PATH } from "@hx-aioa/protocol";
import { HEARTBEAT_MS, RECONNECT_MAX_MS, RECONNECT_MIN_MS, REFRESH_EARLY_MS, TOKEN_WAIT_MS } from "./constants";
import type { Frame, FromHub, LinkState, Token, ToHub } from "./link-proto";

type Client = { id: string; post: (m: FromHub) => void; visible: boolean; watch: string[] };
// 新标签加入时补给它的帧: 只有最后一份有意义, 其余帧不缓存
const STICKY = new Set(["welcome", "probes", "hosts", "agents", "online"]);

/**
 * 一个浏览器里唯一的那条 WebSocket。SharedWorker, 选出来的主标签, 或单页兜底都用它;
 * 页面只是 Client。所有页面都隐藏且断线时不重连, 有页面回到前台再连。
 */
export class LinkHub {
  private clients = new Map<string, Client>();
  private ws: WebSocket | null = null;
  private state: LinkState = "idle";
  private retry = RECONNECT_MIN_MS;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private beat: ReturnType<typeof setInterval> | undefined;
  private since = 0;
  private token: Token | null = null;
  private waiting: ((t: Token | null) => void) | null = null;
  private device = "";
  private base = "";
  private sticky = new Map<string, Frame>();
  private presence = new Map<string, Frame>();
  private sentWatch = "";
  private stopped = false;
  private connecting = false;

  constructor(private readonly onEmpty?: () => void) {}

  add(id: string, post: (m: FromHub) => void): void {
    this.clients.set(id, { id, post, visible: false, watch: [] });
  }

  remove(id: string): void {
    if (!this.clients.delete(id)) return;
    if (this.clients.size === 0) {
      this.shutdown();
      this.onEmpty?.();
      return;
    }
    this.syncWatch();
  }

  ids(): string[] {
    return [...this.clients.keys()];
  }

  receive(id: string, m: ToHub): void {
    const c = this.clients.get(id);
    if (!c) return;
    switch (m.op) {
      case "hello":
        c.visible = m.visible;
        c.watch = m.watch;
        this.device = m.device;
        this.base = m.base;
        if (m.token) this.acceptToken(m.token);
        this.stopped = false;
        c.post({ op: "state", s: this.state });
        if (this.state === "online") this.replay(c);
        this.syncWatch();
        return this.wake();
      case "token":
        return this.acceptToken(m.token);
      case "write":
        if (m.frame.t === "watch") {
          c.watch = Array.isArray(m.frame.subjects) ? (m.frame.subjects as string[]) : [];
          return this.syncWatch();
        }
        return void this.send(m.frame);
      case "seen":
        if (m.seq > this.since) this.since = m.seq;
        return;
      case "visible":
        c.visible = m.visible;
        return this.wake();
      case "bye":
        return this.remove(id);
    }
  }

  private acceptToken(t: Token | null): void {
    if (t) this.token = t;
    const w = this.waiting;
    this.waiting = null;
    w?.(t);
  }

  private anyVisible(): boolean {
    for (const c of this.clients.values()) if (c.visible) return true;
    return false;
  }

  private broadcast(m: FromHub): void {
    for (const c of this.clients.values()) c.post(m);
  }

  private set(s: LinkState): void {
    if (this.state === s) return;
    this.state = s;
    this.broadcast({ op: "state", s });
  }

  private replay(c: Client): void {
    for (const f of this.sticky.values()) c.post({ op: "frame", f });
    for (const f of this.presence.values()) c.post({ op: "frame", f });
  }

  private send(f: Frame): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(f));
    return true;
  }

  // 各页面在看的指标主体取并集, 只在变化时发; 重连后服务端忘了, 要再发一次
  private syncWatch(): void {
    const all = [...new Set([...this.clients.values()].flatMap((c) => c.watch))].sort();
    const key = all.join("\n");
    if (key === this.sentWatch) return;
    if (this.send({ t: "watch", subjects: all })) this.sentWatch = key;
  }

  // 有页面在前台且没连着: 立刻连 (退避清零)
  private wake(): void {
    if (this.stopped || this.ws || !this.anyVisible() || this.clients.size === 0) return;
    clearTimeout(this.timer);
    this.retry = RECONNECT_MIN_MS;
    void this.connect();
  }

  private needToken(): Promise<Token | null> {
    if (this.token && this.token.exp - Date.now() > REFRESH_EARLY_MS) return Promise.resolve(this.token);
    const asked = [...this.clients.values()].find((c) => c.visible) ?? this.clients.values().next().value;
    if (!asked) return Promise.resolve(null);
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        this.waiting = null;
        resolve(null);
      }, TOKEN_WAIT_MS);
      this.waiting = (v) => {
        clearTimeout(t);
        resolve(v && v.exp - Date.now() > 0 ? v : null);
      };
      asked.post({ op: "need-token" });
    });
  }

  private async connect(): Promise<void> {
    if (this.ws || this.connecting || this.stopped) return;
    this.connecting = true;
    this.set("connecting");
    const token = await this.needToken();
    this.connecting = false;
    if (this.ws || this.stopped || this.clients.size === 0) return;
    if (!token) {
      this.set("offline");
      return this.schedule();
    }
    const url = new URL(STREAM_PATH, this.base);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set(QUERY_TOKEN, token.value);
    url.searchParams.set(QUERY_DEVICE, this.device);
    // 插件按端兼容 (#156): 服务端据此过滤界面贡献
    url.searchParams.set(QUERY_CLIENT, "web");
    url.searchParams.set(QUERY_CLIENT_BUILD, String(__WEB_BUILD__.web));
    if (this.since > 0) url.searchParams.set(QUERY_SINCE, String(this.since));
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = RECONNECT_MIN_MS;
      // 新连接上服务端不记得 watch; 没人在看就不用发
      this.sentWatch = "";
      this.set("online");
      this.syncWatch();
      clearInterval(this.beat);
      this.beat = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(PING_TEXT), HEARTBEAT_MS);
    };
    ws.onmessage = (e) => {
      if (typeof e.data !== "string" || e.data === PONG_TEXT) return;
      let f: Frame;
      try {
        f = JSON.parse(e.data) as Frame;
      } catch {
        return;
      }
      if (typeof f.t !== "string") return;
      this.track(f);
      this.broadcast({ op: "frame", f });
    };
    ws.onclose = (e) => {
      clearInterval(this.beat);
      if (this.ws === ws) this.ws = null;
      if (e.code === CLOSE_KICKED || e.code === CLOSE_REVOKED) {
        this.broadcast({ op: "kicked" });
        this.shutdown();
        return;
      }
      // 握手被拒 (令牌失效) 也走这里: 丢掉令牌, 下次重新要
      if (e.code === 1006 || e.code === 1008) this.token = null;
      this.set("offline");
      this.schedule();
    };
  }

  private track(f: Frame): void {
    if (f.t === "ev") {
      const seq = Number((f.ev as { seq?: number } | undefined)?.seq) || 0;
      if (seq > this.since) this.since = seq;
    } else if (f.t === "welcome") {
      const head = Number(f.head) || 0;
      if (f.resync || head > this.since) this.since = head;
    } else if (f.t === "presence" && typeof f.channel === "string") {
      this.presence.set(f.channel, f);
    }
    if (STICKY.has(f.t)) this.sticky.set(f.t, f);
  }

  private schedule(): void {
    if (this.stopped || !this.anyVisible() || this.clients.size === 0) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.connect(), this.retry);
    this.retry = Math.min(this.retry * 2, RECONNECT_MAX_MS);
  }

  shutdown(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    clearInterval(this.beat);
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.sticky.clear();
    this.presence.clear();
    this.token = null;
    this.since = 0;
    this.set("idle");
  }
}
