import { messageInput } from "./api-events";
import type { Core } from "./core";

const TERM_SOURCE = "终端";

/** 终端开关记一条消息到 "终端" 群: 打开时按规则提醒, 关闭时静默。 */
export async function termAudit(core: Core, text: string, loud: boolean): Promise<void> {
  const input = messageInput({ text });
  if (typeof input === "string") return;
  const origin = { source: { id: TERM_SOURCE, name: TERM_SOURCE }, sourceInfo: null };
  await core.pipeline.fromInput(input, origin, loud ? undefined : { action: "silent", channels: ["ws"], reason: "终端关闭" });
}
