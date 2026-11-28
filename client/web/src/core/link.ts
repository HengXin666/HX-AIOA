import type { SendFrame } from "@hx-aioa/protocol";
import { accessToken, currentToken, deviceId, signOutLocal } from "./auth";
import { CHANNEL_LINK, LOCK_LEADER, LOCK_TAB_PREFIX } from "./constants";
import { Emitter } from "./emitter";
import { LinkHub } from "./link-hub";
import type { Frame, FromHub, LinkState, ToHub } from "./link-proto";

export type { Frame, LinkState } from "./link-proto";

type Mode = "worker" | "leader" | "follower" | "direct";
type BcMsg = { from?: string; to?: string; m: ToHub | FromHub };

/**
 * 页面这一侧的连接: 对外 API 与单页时一样。真正的 WebSocket 在 SharedWorker 里;
 * 不支持时用 BroadcastChannel + navigator.locks 选一个主标签持有; 都没有就本页自己连。
 */
class Link {
  readonly frames = new Emitter<Frame>();
  readonly states = new Emitter<LinkState>();
  state: LinkState = "idle";
  mode: Mode | null = null;
  private readonly id = crypto.randomUUID();
  private running = false;
  private cid = 0;
  private watch: string[] = [];
  private port: MessagePort | null = null;
  private bc: BroadcastChannel | null = null;
  private hub: LinkHub | null = null;
  private heard = false;
  private release: (() => void)[] = [];

  start(): void {
    if (this.running) return;
    this.running = true;
    document.addEventListener("visibilitychange", this.onVisible);
    window.addEventListener("online", this.onVisible);
    window.addEventListener("pagehide", this.onHide);
    void this.holdTab().then(() => this.running && this.open());
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    document.removeEventListener("visibilitychange", this.onVisible);
    window.removeEventListener("online", this.onVisible);
    window.removeEventListener("pagehide", this.onHide);
    this.post({ op: "bye" });
    const { port, bc, hub } = this;
    this.port = null;
    this.bc = null;
    this.hub = null;
    this.mode = null;
    hub?.shutdown();
    port?.close();
    bc?.close();
    for (const r of this.release.splice(0)) r();
    this.set("idle");
  }

  // 已收到的最大 seq, 重连时补发它之后的事件
  seen(seq: number): void {
    this.post({ op: "seen", seq });
  }

  send(frame: Omit<SendFrame, "t" | "cid">): string | null {
    const cid = `w${Date.now().toString(36)}${(this.cid++).toString(36)}`;
    return this.write({ t: "send", cid, ...frame }) ? cid : null;
  }

  write(frame: Frame | object): boolean {
    const f = frame as Frame;
    if (f.t === "watch") this.watch = Array.isArray(f.subjects) ? (f.subjects as string[]) : [];
    if (this.state !== "online" && f.t !== "watch") return false;
    this.post({ op: "write", frame: f });
    return true;
  }

  // 本标签存活的标记: 持有方拿到同名锁即说明标签已关
  private holdTab(): Promise<void> {
    const locks = navigator.locks;
    if (!locks) return Promise.resolve();
    return new Promise((ready) => {
      void locks.request(LOCK_TAB_PREFIX + this.id, () => {
        ready();
        return new Promise<void>((r) => this.release.push(r));
      });
    });
  }

  private open(): void {
    if (typeof SharedWorker !== "undefined" && this.openWorker()) return;
    if (typeof BroadcastChannel !== "undefined" && navigator.locks) return this.openElection();
    this.openDirect();
  }

  private openWorker(): boolean {
    try {
      const w = new SharedWorker(new URL("./link-worker.ts", import.meta.url), { type: "module", name: "aioa-link" });
      this.mode = "worker";
      this.port = w.port;
      this.port.onmessage = (e: MessageEvent<FromHub>) => this.onHub(e.data);
      this.port.start();
      w.onerror = () => {
        if (this.heard || !this.running) return;
        this.port?.close();
        this.port = null;
        this.openDirect();
      };
      this.hello();
      return true;
    } catch {
      return false;
    }
  }

  private openElection(): void {
    const bc = new BroadcastChannel(CHANNEL_LINK);
    this.bc = bc;
    this.mode = "follower";
    bc.onmessage = (e: MessageEvent<BcMsg>) => this.onBc(e.data);
    void navigator.locks.request(LOCK_LEADER, () => {
      if (!this.running) return;
      this.becomeLeader();
      return new Promise<void>((r) => this.release.push(r));
    });
    this.hello();
  }

  private openDirect(): void {
    this.mode = "direct";
    this.hub = new LinkHub();
    this.hub.add(this.id, (m) => this.onHub(m));
    this.hello();
  }

  private becomeLeader(): void {
    const bc = this.bc;
    if (!bc) return;
    this.mode = "leader";
    this.hub = new LinkHub();
    this.hub.add(this.id, (m) => this.onHub(m));
    bc.postMessage({ to: "*", m: { op: "who" } } satisfies BcMsg);
    this.hello();
  }

  private onBc(d: BcMsg): void {
    if (d.from && this.mode === "leader" && this.hub) {
      const m = d.m as ToHub;
      const from = d.from;
      if (m.op === "hello" && !this.hub.ids().includes(from)) {
        this.hub.add(from, (x) => {
          try {
            this.bc?.postMessage({ to: from, m: x } satisfies BcMsg);
          } catch {
            // 本标签正在退出
          }
        });
        void navigator.locks.request(LOCK_TAB_PREFIX + from, () => this.hub?.remove(from));
      }
      this.hub.receive(from, m);
    } else if (d.to && this.mode === "follower" && (d.to === this.id || d.to === "*")) {
      this.onHub(d.m as FromHub);
    }
  }

  private post(m: ToHub): void {
    try {
      if (this.mode === "worker") this.port?.postMessage(m);
      else if (this.mode === "follower") this.bc?.postMessage({ from: this.id, m } satisfies BcMsg);
      else this.hub?.receive(this.id, m);
    } catch {
      // 通道已关 (退出或换主中), 丢弃
    }
  }

  private hello(): void {
    const token = currentToken() ?? undefined;
    this.post({ op: "hello", id: this.id, visible: visible(), device: deviceId(), base: location.href, watch: this.watch, token });
  }

  private onHub(m: FromHub): void {
    this.heard = true;
    switch (m.op) {
      case "frame":
        return this.frames.emit(m.f);
      case "state":
        return this.set(m.s);
      case "need-token":
        return void accessToken().then(() => this.post({ op: "token", token: currentToken() }));
      case "who":
        return this.hello();
      case "kicked":
        this.stop();
        return signOutLocal();
    }
  }

  private readonly onVisible = (): void => this.post({ op: "visible", visible: visible() });
  private readonly onHide = (): void => this.post({ op: "visible", visible: false });

  private set(s: LinkState): void {
    if (this.state === s) return;
    this.state = s;
    this.states.emit(s);
  }
}

const visible = () => document.visibilityState === "visible";

export const link = new Link();
