import type { ChatSyncFrame } from "@hx-aioa/protocol";
import type { Core } from "./core";

/**
 * Agent 只有一个名字 (#139): 群 Agent 的名字就是它发言的名字。
 * 以前 PATCH agents 改 name, PATCH senders 改别名, 两处并存且别名优先, 改了名字页面上看不出变化;
 * 现在两个入口都改 Agent 的名字, 发送者别名清掉 (头像仍在发送者上)。
 */
export function dropAgentAlias(core: Core, sid: string, name: string): void {
  const s = core.pipeline.senders;
  if (!s) return;
  s.syncAgents([{ id: sid, name }]);
  if (s.get(sid)?.alias) s.patch(sid, { alias: null });
  core.sockets.toAllClients({ t: "chat_sync", topic: "senders" } satisfies ChatSyncFrame);
}
