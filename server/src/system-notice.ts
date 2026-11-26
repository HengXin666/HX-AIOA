import { SYSTEM_CHANNEL, SYSTEM_CHANNEL_TITLE, type EventInput, type SourceRef } from "@hx-aioa/protocol";
import type { Core } from "./core";

/**
 * 没有所属群的系统通知 (CF 额度, GitHub 授权到期等) 发进 "系统通知" 群 (#123): 原先按发送者名字自动归组,
 * 群名和发送者都叫 "系统", 也改不了头像; 现在是真群, 能改头像, 免打扰。群第一次用到时建好资料。
 */
export async function systemNotice(core: Core, input: EventInput, source: SourceRef): Promise<void> {
  if (!core.chats.chat(SYSTEM_CHANNEL)) core.chats.patchChat(SYSTEM_CHANNEL, { title: SYSTEM_CHANNEL_TITLE });
  await core.pipeline.fromInput({ ...input, channel: SYSTEM_CHANNEL }, { source, sourceInfo: null });
}
