import { type ClientKind, type Envelope, type HostCard, type StreamRole, globMatch } from "@hx-aioa/protocol";
import { groupOf } from "./store";
import { PROTO_LEGACY, PROTO_V1 } from "./constants";
import { toMsgFrame } from "./legacy";

export type Attachment = {
  device: string;
  proto: typeof PROTO_LEGACY | typeof PROTO_V1;
  role: StreamRole;
  keyId?: string;
  agents?: string[];
  watch?: string[];
  offer?: string[];
  demand?: string[];
  host?: HostCard;
  // 探针: key 带 probe:shell; 两端: 进行中的终端会话 id
  shell?: boolean;
  // 探针: key 带 probe:agent (Agent GUI)
  agent?: boolean;
  terms?: string[];
  // 人的连接: 账号 id; member 为子号, 只收自己所在群的消息
  uid?: string;
  member?: boolean;
  // 安卓后台常驻连接: 不推 presence
  bg?: boolean;
  // role=chat (CLI 长连): 能读的群 (通配) 与显示名
  reads?: string[];
  name?: string;
  // 握手时带的端与构建号 (#156), 插件界面按它过滤; 老客户端不带
  client?: ClientKind;
  cb?: number;
};

export function trySend(ws: WebSocket, text: string): boolean {
  try {
    ws.send(text);
    return true;
  } catch {
    return false;
  }
}

export const sendFrame = (ws: WebSocket, frame: unknown) => trySend(ws, JSON.stringify(frame));
export const attOf = (ws: WebSocket) => ws.deserializeAttachment() as Attachment;

type Conn = { ws: WebSocket; a: Attachment };
const OWNER_KEY = "";
// 人的连接按账号分好: 主人的 (非子号) 与各子号的; 只在连上 / 断开时重建, 推消息不再逐个解 attachment
type Index = { owner: Conn[]; byUid: Map<string, Conn[]> };

// 连接分组与广播: 全部状态在 attachment 里, 休眠唤醒后照样可用
// 该设备有前台长连接 (页面开着); 安卓后台连接不算
export function foregroundOn(list: WebSocket[], device: string): boolean {
  return list.some((ws) => {
    const a = attOf(ws);
    return a.device === device && a.role === "client" && !a.bg;
  });
}

export class Sockets {
  private index: Index | null = null;

  constructor(
    private readonly all: () => WebSocket[],
    // 这条事件所在群的成员账号 id; 主人的连接总是收到
    private readonly audience: (ev: Envelope) => Set<string>,
    // 主人看不到的群 (别人之间的单聊)
    private readonly hidden: (grp: string) => boolean = () => false,
  ) {}

  /** 有连接连上或断开: 下次推送时重建分组。gone 是正在关的那条 (关闭回调里它还在列表中)。 */
  reset(gone?: WebSocket): void {
    this.index = null;
    if (!gone) return;
    this.gone.add(gone);
    const a = attOf(gone);
    if (a.role === "client" && !a.bg) this.left.set(a.member ? (a.uid ?? "") : OWNER_KEY, Date.now());
  }

  private readonly gone = new WeakSet<WebSocket>();
  // 人的前台连接最近断开的时间 (#130), 只在内存; 主人记在 OWNER_KEY 下
  private readonly left = new Map<string, number>();

  private idx(): Index {
    if (this.index) return this.index;
    const out: Index = { owner: [], byUid: new Map() };
    for (const ws of this.all()) {
      if (this.gone.has(ws)) continue;
      const a = attOf(ws);
      if (a.role !== "client") continue;
      if (!a.member) out.owner.push({ ws, a });
      else if (a.uid) out.byUid.set(a.uid, [...(out.byUid.get(a.uid) ?? []), { ws, a }]);
    }
    this.index = out;
    return out;
  }

  /** 有前台连接 (安卓后台常驻连接不算) 的账号; 主人的连接记成 ownerId。 */
  onlineUids(ownerId: string): Set<string> {
    const { owner, byUid } = this.idx();
    const out = new Set<string>();
    if (owner.some((x) => !x.a.bg)) out.add(ownerId);
    for (const [uid, conns] of byUid) if (conns.some((x) => !x.a.bg)) out.add(uid);
    return out;
  }

  /** 这个账号的前台连接最近一次断开的时间, 没记过返回 0。 */
  leftAt(uid: string, ownerId: string): number {
    return this.left.get(uid === ownerId ? OWNER_KEY : uid) ?? 0;
  }

  clients(): WebSocket[] {
    return this.all().filter((ws) => attOf(ws).role === "client");
  }

  agentSockets(agentId: string): WebSocket[] {
    return this.all().filter((ws) => {
      const a = attOf(ws);
      return a.role === "agent" && (a.agents ?? []).includes(agentId);
    });
  }

  onlineAgents(): Set<string> {
    const out = new Set<string>();
    for (const ws of this.all()) {
      const a = attOf(ws);
      if (a.role === "agent") for (const id of a.agents ?? []) out.add(id);
    }
    return out;
  }

  /** CLI 长连里能读这个群的。 */
  listeners(channel: string): WebSocket[] {
    return this.all().filter((ws) => {
      const a = attOf(ws);
      return a.role === "chat" && (a.reads ?? []).some((p) => globMatch(p, channel));
    });
  }

  /** 某把 key 的 CLI 长连 (群 Agent 收 guide 帧, 插件 Agent 收指令更新)。 */
  chatSockets(keyId: string): WebSocket[] {
    return this.all().filter((ws) => {
      const a = attOf(ws);
      return a.role === "chat" && a.keyId === keyId;
    });
  }

  /** 发给看得到这个群的人 (只用于 presence): 主人的连接都收, 子号只在群成员里时收, 安卓后台连接不收。 */
  toChannel(members: Set<string>, frame: unknown): void {
    const text = JSON.stringify(frame);
    const { owner, byUid } = this.idx();
    const conns = [...owner, ...[...members].flatMap((u) => byUid.get(u) ?? [])];
    for (const { ws, a } of conns) if (a.proto === PROTO_V1 && !a.bg) trySend(ws, text);
  }

  // 新客户端收 ev 帧, 旧客户端收压成一行的 msg 帧; 子号只查本群成员的连接
  deliverEv(ev: Envelope): number {
    const v1 = JSON.stringify({ t: "ev", ev });
    const legacy = JSON.stringify(toMsgFrame(ev));
    const grp = groupOf(ev);
    const { owner, byUid } = this.idx();
    const members = byUid.size && grp ? [...this.audience(ev)].flatMap((u) => byUid.get(u) ?? []) : [];
    const conns = grp && this.hidden(grp) ? members : [...owner, ...members];
    let n = 0;
    for (const { ws, a } of conns) if (trySend(ws, a.proto === PROTO_V1 ? v1 : legacy)) n += 1;
    // CLI 长连: 只给能读这个群的, 不计入送达 (送达只看人的设备)
    if (grp) for (const ws of this.listeners(grp)) trySend(ws, v1);
    return n;
  }

  // 只有 v1 客户端认识的帧 (task, task_log, agents, settings), 只给主人
  toV1Clients(frame: unknown): void {
    const text = JSON.stringify(frame);
    for (const { ws, a } of this.idx().owner) if (a.proto === PROTO_V1) trySend(ws, text);
  }

  /** 同 toV1Clients, 但按连接出帧 (如按端裁剪工作台); 同一端同一构建号只算一次, 返回 null 的不发。 */
  toV1ClientsBy(frameOf: (a: Attachment) => unknown): void {
    const memo = new Map<string, string | null>();
    for (const { ws, a } of this.idx().owner) {
      if (a.proto !== PROTO_V1) continue;
      const key = `${a.client ?? ""}:${a.cb ?? ""}`;
      if (!memo.has(key)) {
        const f = frameOf(a);
        memo.set(key, f === null ? null : JSON.stringify(f));
      }
      const text = memo.get(key);
      if (text) trySend(ws, text);
    }
  }

  // 群资料变化之类所有人都该知道的轻量通知
  toAllClients(frame: unknown): void {
    const text = JSON.stringify(frame);
    const { owner, byUid } = this.idx();
    for (const { ws, a } of [...owner, ...[...byUid.values()].flat()]) if (a.proto === PROTO_V1) trySend(ws, text);
  }

  /** 按收帧人分别出帧 (群资料按各自视图): owner 为主人的连接, 其余按子号账号; 返回 null 的不发。 */
  toEach(uids: Iterable<string>, frameOf: (uid: string | null) => unknown): void {
    const { owner, byUid } = this.idx();
    const send = (conns: Conn[], f: unknown) => {
      if (f === null) return;
      const text = JSON.stringify(f);
      for (const { ws, a } of conns) if (a.proto === PROTO_V1) trySend(ws, text);
    };
    if (owner.length) send(owner, frameOf(null));
    for (const u of new Set(uids)) {
      const conns = byUid.get(u);
      if (conns?.length) send(conns, frameOf(u));
    }
  }

  /** 某个账号的全部设备 (主人的账号 id 也可以)。 */
  toUser(uid: string, ownerId: string, frame: unknown): void {
    const text = JSON.stringify(frame);
    const conns = uid === ownerId ? this.idx().owner : (this.idx().byUid.get(uid) ?? []);
    for (const { ws, a } of conns) if (a.proto === PROTO_V1) trySend(ws, text);
  }
}
