import { type Envelope, type HostCard, type StreamRole, globMatch } from "@hx-aioa/protocol";
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
  terms?: string[];
  // 人的连接: 账号 id; member 为子号, 只收自己所在群的消息
  uid?: string;
  member?: boolean;
  // 安卓后台常驻连接: 不推 presence
  bg?: boolean;
  // role=chat (CLI 长连): 能读的群 (通配) 与显示名
  reads?: string[];
  name?: string;
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

// 连接分组与广播: 全部状态在 attachment 里, 休眠唤醒后照样可用
export class Sockets {
  constructor(
    private readonly all: () => WebSocket[],
    // 这条事件所在群的成员账号 id; 主人的连接总是收到
    private readonly audience: (ev: Envelope) => Set<string>,
  ) {}

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

  /** CLI 长连里用这把 key 的 (插件 Agent 收指令更新)。 */
  agentListeners(keyId: string): WebSocket[] {
    return this.all().filter((ws) => {
      const a = attOf(ws);
      return a.role === "chat" && a.keyId === keyId;
    });
  }

  /** 发给看得到这个群的人 (只用于 presence): 主人的连接都收, 子号只在群成员里时收, 安卓后台连接不收。 */
  toChannel(members: Set<string>, frame: unknown): void {
    const text = JSON.stringify(frame);
    for (const ws of this.clients()) {
      const a = attOf(ws);
      if (a.proto !== PROTO_V1 || a.bg || (a.member && !(a.uid && members.has(a.uid)))) continue;
      trySend(ws, text);
    }
  }

  // 新客户端收 ev 帧, 旧客户端收压成一行的 msg 帧
  deliverEv(ev: Envelope): number {
    const v1 = JSON.stringify({ t: "ev", ev });
    const legacy = JSON.stringify(toMsgFrame(ev));
    let n = 0;
    let who: Set<string> | undefined;
    for (const ws of this.clients()) {
      const a = attOf(ws);
      if (a.member) {
        who ??= this.audience(ev);
        if (!a.uid || !who.has(a.uid)) continue;
      }
      if (trySend(ws, a.proto === PROTO_V1 ? v1 : legacy)) n += 1;
    }
    // CLI 长连: 只给能读这个群的, 不计入送达 (送达只看人的设备)
    const grp = groupOf(ev);
    if (grp) for (const ws of this.listeners(grp)) trySend(ws, v1);
    return n;
  }

  // 只有 v1 客户端认识的帧 (task, task_log, agents, settings), 只给主人
  toV1Clients(frame: unknown): void {
    const text = JSON.stringify(frame);
    for (const ws of this.clients()) {
      const a = attOf(ws);
      if (a.proto === PROTO_V1 && !a.member) trySend(ws, text);
    }
  }

  // 群资料变化之类所有人都该知道的轻量通知
  toAllClients(frame: unknown): void {
    const text = JSON.stringify(frame);
    for (const ws of this.clients()) if (attOf(ws).proto === PROTO_V1) trySend(ws, text);
  }
}
