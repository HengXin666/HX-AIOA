import { Emitter } from "../core/emitter";
import { HANDSHAKE_TIMEOUT_MS, HELLO_TIMEOUT_MS, HX_TIMEOUT_MS, LIVENESS_TIMEOUT_MS, RETRY_MAX_MS, RETRY_MIN_MS, ROUTE_FAIL_ROUNDS, SLOW_RETRY_MS, TXT_APPROVE_ONLY, TXT_AUTH_FAIL, TXT_HOST_CHANGED, TXT_NOT_READY } from "./constants";
import { agHub } from "./hub";
import { deviceKey, sameKey, signNonce } from "./keys";
import { getPair, rememberRoute, routeBlock, routeOrder, type Pair } from "./pairs";
import { SessionStore } from "./session";
import type { AuthMethod, AuthNeed, Hello, Instance, JsonRpc, ProbeFrame, Route, SessionInfo, Settings } from "./types";

// noroute: 没有路线或全被过滤; unreachable: 可试的路线连续几轮都不通 (只能审批, 慢速重试)
export type ConnState = "idle" | "connecting" | "ready" | "retry" | "unpaired" | "noroute" | "unreachable" | "auth" | "changed";
export type RouteNote = { route: Route; why: string };
export type ConnSnap = {
  state: ConnState;
  route: Route | null;
  sessions: SessionInfo[];
  instances: Instance[];
  settings: Settings | null;
  err: string;
  stale: boolean;
  // 在这台设备上被跳过的路线与原因
  skipped: RouteNote[];
  // Agent 未登录 (探针报 auth_required)
  login: AuthNeed | null;
  version: number;
};

// 与 WebSocket 同形的最小接口, dev 下的模拟探针也实现它
export type Sock = { send(s: string): void; close(): void; onopen: (() => void) | null; onmessage: ((e: { data: unknown }) => void) | null; onclose: (() => void) | null; readyState: number };
export type SockFactory = (url: string) => Sock;
type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

const OPEN = 1;
const jitter = (ms: number) => ms * (0.5 + Math.random());
const wsUrl = (http: string) => http.replace(/^http/, "ws").replace(/\/$/, "") + "/ws";

/** 一台主机唯一的连接主人: 唯一的重试者, 路线按序试, 先验主机公钥再签挑战, 断线按 seq 补帧。 */
export class HostConn {
  readonly changed = new Emitter<void>();
  private snap: ConnSnap = { state: "idle", route: null, sessions: [], instances: [], settings: null, err: "", stale: false, skipped: [], login: null, version: 0 };
  private fails = 0;
  private sock: Sock | null = null;
  private retry = RETRY_MIN_MS;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private hxId = 0;
  private acpId = 0;
  private hxWait = new Map<number, Pending>();
  private acpWait = new Map<number, Pending>();
  private stores = new Map<string, SessionStore>();
  private attached = new Map<string, number>();

  constructor(
    readonly host: string,
    private readonly factory: SockFactory = (u) => new WebSocket(u) as unknown as Sock,
    private readonly skipHello = false,
  ) {}

  snapshot = (): ConnSnap => this.snap;

  private set(p: Partial<ConnSnap>): void {
    this.snap = { ...this.snap, ...p, version: this.snap.version + 1 };
    this.changed.emit();
  }

  session(sid: string): SessionStore {
    let s = this.stores.get(sid);
    if (!s) {
      s = new SessionStore(sid);
      this.stores.set(sid, s);
    }
    return s;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    document.addEventListener("visibilitychange", this.onVisible);
    window.addEventListener("online", this.onOnline);
    void this.connect();
  }

  stop(): void {
    this.running = false;
    clearTimeout(this.timer);
    document.removeEventListener("visibilitychange", this.onVisible);
    window.removeEventListener("online", this.onOnline);
    this.drop();
    this.set({ state: "idle" });
  }

  // 配对后或用户点重试: 退避清零, 立刻再试
  kick(): void {
    clearTimeout(this.timer);
    this.retry = RETRY_MIN_MS;
    if (!this.running) return this.start();
    if (this.snap.state !== "ready" && this.snap.state !== "connecting") void this.connect();
  }

  private drop(): void {
    const s = this.sock;
    this.sock = null;
    if (s) {
      s.onclose = null;
      s.onmessage = null;
      s.close();
    }
    for (const w of [...this.hxWait.values(), ...this.acpWait.values()]) {
      clearTimeout(w.timer);
      w.reject(new Error(TXT_NOT_READY));
    }
    this.hxWait.clear();
    this.acpWait.clear();
  }

  private schedule(state: ConnState, err = ""): void {
    this.drop();
    const hard = state === "auth" || state === "changed" || state === "unpaired" || state === "unreachable";
    this.set({ state: hard ? state : "retry", err, stale: this.snap.sessions.length > 0 });
    if (!this.running) return;
    clearTimeout(this.timer);
    const wait = hard ? SLOW_RETRY_MS : jitter(this.retry);
    if (!hard) this.retry = Math.min(this.retry * 2, RETRY_MAX_MS);
    if (state === "changed") return;
    this.timer = setTimeout(() => void this.connect(), wait);
  }

  private async connect(): Promise<void> {
    if (!this.running || this.sock) return;
    const pair = getPair(this.host);
    if (!pair) return this.set({ state: "unpaired" });
    if (pair.routes.length === 0) return this.set({ state: "noroute", err: "", skipped: [] });
    const order = routeOrder(pair);
    // dev 模拟探针 (skipHello) 不过滤
    const block = (r: Route) => (this.skipHello ? "" : routeBlock(r));
    const skipped = order.flatMap((route) => {
      const why = block(route);
      return why ? [{ route, why }] : [];
    });
    const usable = order.filter((r) => !block(r));
    // 这台设备上一条能试的都没有: 不退避重试, 直接说只能审批
    if (usable.length === 0) return this.set({ state: "noroute", err: TXT_APPROVE_ONLY, skipped });
    this.set({ state: "connecting", skipped });
    for (const r of usable) {
      if (!this.running) return;
      const ok = this.skipHello || (await this.hello(r, pair));
      if (ok === "changed") return this.schedule("changed", TXT_HOST_CHANGED);
      if (!ok) continue;
      const res = await this.handshake(r, pair);
      if (res === "ok") return;
      if (res === "auth" || res === "changed") return this.schedule(res, res === "auth" ? TXT_AUTH_FAIL : TXT_HOST_CHANGED);
    }
    this.fails++;
    this.schedule(this.fails >= ROUTE_FAIL_ROUNDS ? "unreachable" : "retry", this.fails >= ROUTE_FAIL_ROUNDS ? TXT_APPROVE_ONLY : "");
  }

  // 先确认对端就是配对时那台主机, 再把签名交出去
  private async hello(r: Route, pair: Pair): Promise<boolean | "changed"> {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), HELLO_TIMEOUT_MS);
    try {
      const res = await fetch(r.url.replace(/\/$/, "") + "/hello", { signal: ctl.signal, cache: "no-store" });
      if (!res.ok) return false;
      const h = (await res.json()) as Hello;
      return sameKey(h.pub, pair.pub) ? true : "changed";
    } catch {
      return false;
    } finally {
      clearTimeout(t);
    }
  }

  private handshake(r: Route, pair: Pair): Promise<"ok" | "fail" | "auth" | "changed"> {
    return new Promise((done) => {
      let settled = false;
      const finish = (v: "ok" | "fail" | "auth" | "changed") => {
        if (settled) return;
        settled = true;
        clearTimeout(t);
        if (v !== "ok") {
          sock.onclose = null;
          sock.onmessage = null;
          sock.close();
        }
        done(v);
      };
      const t = setTimeout(() => finish("fail"), HANDSHAKE_TIMEOUT_MS);
      let sock: Sock;
      try {
        sock = this.factory(wsUrl(r.url));
      } catch {
        clearTimeout(t);
        return done("fail");
      }
      sock.onclose = () => finish("fail");
      sock.onmessage = (e) => {
        for (const f of parse(e.data)) {
          if (f.t === "challenge") {
            if (!this.skipHello && !sameKey(f.pub, pair.pub)) return finish("changed");
            void Promise.all([deviceKey(), signNonce(f.nonce)])
              .then(([k, sig]) => sock.send(JSON.stringify({ t: "hello", device: k.id, sig, fg: document.visibilityState === "visible" })))
              .catch(() => finish("fail"));
          } else if (f.t === "error" && f.code === "auth") return finish("auth");
          else if (f.t === "ready") {
            finish("ok");
            this.onReady(sock, r, f);
          }
        }
      };
    });
  }

  private onReady(sock: Sock, r: Route, f: Extract<ProbeFrame, { t: "ready" }>): void {
    this.sock = sock;
    this.retry = RETRY_MIN_MS;
    this.fails = 0;
    rememberRoute(this.host, r.url);
    sock.onmessage = (e) => {
      for (const x of parse(e.data)) this.onFrame(x);
    };
    sock.onclose = () => {
      if (this.sock === sock) this.schedule("retry");
    };
    this.set({ state: "ready", route: r, sessions: f.sessions ?? [], instances: f.instances ?? [], settings: f.settings ?? null, err: "", stale: false });
    for (const sid of this.attached.keys()) this.sendAttach(sid);
  }

  private onFrame(f: ProbeFrame): void {
    switch (f.t) {
      case "acp":
        return this.onAcp(f.sid, f.seq, f.m, f.at);
      case "window":
        return this.session(f.sid).window(f.from, f.items ?? [], f.more);
      case "perm_req":
        return this.session(f.sid).permReq({ ...f.card, host: f.card.host || this.host, sid: f.sid, rid: f.rid });
      case "perm_done":
        agHub.dropCard(this.host, f.sid, f.rid);
        return this.session(f.sid).permDone(f.rid);
      case "session":
        return this.putSession(f.info);
      case "error":
        if (f.code === "auth_required") this.set({ login: { msg: f.msg || "Agent 还没登录", methods: authMethods(f.methods), instance: f.instance, sid: f.sid, at: Date.now() } });
        return;
      case "stats":
        return this.session(f.sid).stats(f);
      case "hx_res": {
        const w = this.hxWait.get(f.id);
        if (!w) return;
        this.hxWait.delete(f.id);
        clearTimeout(w.timer);
        return f.ok ? w.resolve(f.r) : w.reject(new Error(f.err || "失败"));
      }
    }
  }

  private onAcp(sid: string, seq: number, m: JsonRpc, at?: number): void {
    this.session(sid).acp(seq, m, at);
    if (m.method !== undefined || typeof m.id !== "number") return;
    const w = this.acpWait.get(m.id);
    if (!w) return;
    this.acpWait.delete(m.id);
    clearTimeout(w.timer);
    if (m.error) w.reject(new Error(m.error.message));
    else w.resolve(m.result);
  }

  putSession(info: SessionInfo): void {
    const rest = this.snap.sessions.filter((s) => s.id !== info.id);
    this.set({ sessions: [info, ...rest].sort((a, b) => b.updated - a.updated) });
  }

  dropSession(sid: string): void {
    this.set({ sessions: this.snap.sessions.filter((s) => s.id !== sid) });
  }

  setInstances(list: Instance[]): void {
    this.set({ instances: list });
  }

  setSettings(s: Settings): void {
    this.set({ settings: s });
  }

  clearLogin(): void {
    if (this.snap.login) this.set({ login: null });
  }

  private write(f: object): boolean {
    if (this.sock?.readyState !== OPEN || this.snap.state !== "ready") return false;
    this.sock.send(JSON.stringify(f));
    return true;
  }

  hx<T>(m: string, p: object = {}, timeout = HX_TIMEOUT_MS): Promise<T> {
    const id = ++this.hxId;
    return new Promise<T>((resolve, reject) => {
      if (!this.write({ t: "hx", id, m, p })) return reject(new Error(TXT_NOT_READY));
      const timer = setTimeout(() => {
        this.hxWait.delete(id);
        reject(new Error("主机没有回应"));
      }, timeout);
      this.hxWait.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
    });
  }

  // ACP 请求 id 由这里生成; 探针换成真实 sessionId 与自己的 id, 回包时还原
  acpRequest<T>(sid: string, method: string, params: Record<string, unknown>, timeout = 0): Promise<T> {
    const id = ++this.acpId;
    const m: JsonRpc = { jsonrpc: "2.0", id, method, params: { sessionId: sid, ...params } };
    return new Promise<T>((resolve, reject) => {
      if (!this.write({ t: "acp_out", sid, m })) return reject(new Error(TXT_NOT_READY));
      if (method === "session/prompt") this.session(sid).localPrompt(m);
      const timer = timeout > 0 ? setTimeout(() => this.acpWait.delete(id) && reject(new Error("超时")), timeout) : undefined;
      this.acpWait.set(id, { resolve: resolve as (v: unknown) => void, reject, timer: timer as ReturnType<typeof setTimeout> });
    });
  }

  acpNotify(sid: string, method: string, params: Record<string, unknown>): boolean {
    return this.write({ t: "acp_out", sid, m: { jsonrpc: "2.0", method, params: { sessionId: sid, ...params } } });
  }

  perm(sid: string, rid: string, option: string | null, text = ""): boolean {
    const ok = this.write({ t: "perm", sid, rid, option, text });
    if (ok) this.session(sid).answering(rid, true);
    return ok;
  }

  attach(sid: string): () => void {
    this.attached.set(sid, (this.attached.get(sid) ?? 0) + 1);
    if (this.attached.get(sid) === 1) this.sendAttach(sid);
    return () => {
      const n = (this.attached.get(sid) ?? 1) - 1;
      if (n > 0) return void this.attached.set(sid, n);
      this.attached.delete(sid);
      this.write({ t: "detach", sid });
    };
  }

  private sendAttach(sid: string): void {
    const since = this.session(sid).since();
    this.write(since === undefined ? { t: "attach", sid } : { t: "attach", sid, since });
  }

  older(sid: string): Promise<void> {
    const s = this.session(sid);
    const before = s.snapshot().firstSeq;
    s.setLoadingOlder(true);
    return this.hx("log/page", { sid, before })
      .then(() => undefined)
      .catch((e: Error) => {
        s.setLoadingOlder(false);
        throw e;
      });
  }

  // 回前台先探活: 探活失败才换连接
  private readonly onVisible = (): void => {
    const fg = document.visibilityState === "visible";
    this.write({ t: "fg", on: fg });
    if (!fg) return;
    if (this.snap.state === "ready") {
      void this.hx("settings/get", {}, LIVENESS_TIMEOUT_MS)
        .then((s) => this.setSettings(s as Settings))
        .catch(() => this.schedule("retry"));
    } else if (this.snap.state === "retry" || this.snap.state === "unreachable") this.kick();
  };

  private readonly onOnline = (): void => {
    if (this.snap.state === "retry" || this.snap.state === "unreachable") this.kick();
  };
}

// ACP AuthMethod 原样; 只是字符串时当 id
function authMethods(v: unknown): AuthMethod[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((m): AuthMethod[] => {
    if (typeof m === "string") return [{ id: m, name: m }];
    if (!m || typeof m !== "object") return [];
    const o = m as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id : typeof o.methodId === "string" ? o.methodId : "";
    if (!id) return [];
    return [{ id, name: typeof o.name === "string" && o.name ? o.name : id, description: typeof o.description === "string" ? o.description : undefined }];
  });
}

function parse(data: unknown): ProbeFrame[] {
  if (typeof data !== "string") return [];
  try {
    const v = JSON.parse(data) as ProbeFrame | ProbeFrame[];
    return Array.isArray(v) ? v : [v];
  } catch {
    return [];
  }
}
