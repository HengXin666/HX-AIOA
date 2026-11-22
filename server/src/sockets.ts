import type { Envelope, StreamRole } from "@hx-aioa/protocol";
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
  constructor(private readonly all: () => WebSocket[]) {}

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

  // 新客户端收 ev 帧, 旧客户端收压成一行的 msg 帧
  deliverEv(ev: Envelope): number {
    const v1 = JSON.stringify({ t: "ev", ev });
    const legacy = JSON.stringify(toMsgFrame(ev));
    let n = 0;
    for (const ws of this.clients()) if (trySend(ws, attOf(ws).proto === PROTO_V1 ? v1 : legacy)) n += 1;
    return n;
  }

  // 只有 v1 客户端认识的帧 (task, task_log, agents, settings)
  toV1Clients(frame: unknown): void {
    const text = JSON.stringify(frame);
    for (const ws of this.clients()) if (attOf(ws).proto === PROTO_V1) trySend(ws, text);
  }
}
