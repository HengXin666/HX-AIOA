import { SOURCE_TYPE_USER, USER_SOURCE_PREFIX, type RouteInfo, type SendFrame } from "@hx-aioa/protocol";
import { chatInput } from "./chat";
import { CODE_BAD_REQUEST, CODE_FORBIDDEN, ERR_FORBIDDEN, OWNER_NAME } from "./constants";
import type { Core, Principal } from "./core";
import { attachFile } from "./files/api";
import { ApiFail } from "./http";
import { type Attachment, sendFrame } from "./sockets";
import { groupOf } from "./store";

const ROUTE_SELF: RouteInfo = { action: "silent", channels: ["ws"], reason: "本人发送" };
const ROUTE_ROOM: RouteInfo = { action: "push", channels: ["ws"], reason: "群聊" };

/** 长连接上的 send 帧: 人发消息 (子号只能发到自己所在的群, 也只能引用 / 转发 / 合并自己看得到的消息)。 */
export async function chatSend(core: Core, ws: WebSocket, att: Attachment, frame: SendFrame, who: Principal | null): Promise<void> {
  const member = att.member ? att.uid : undefined;
  const canSee = member === undefined ? () => true : (ev: Parameters<typeof groupOf>[0]) => !!member && !!core.rooms.member(groupOf(ev) ?? "", member);
  const input = chatInput(core.store, frame, canSee);
  if (typeof input === "string") throw new ApiFail(400, CODE_BAD_REQUEST, input);
  if (frame.file && !who) throw new ApiFail(403, CODE_FORBIDDEN, ERR_FORBIDDEN);
  const file = who && frame.file ? attachFile(core, who, frame.file, input.channel) : undefined;
  if (typeof file === "string") throw new ApiFail(400, CODE_BAD_REQUEST, file);
  if (file && input.kind === "event") input.data = { ...input.data, file };
  const grp = input.channel ?? "";
  if (att.member && !(att.uid && core.rooms.member(grp, att.uid))) throw new ApiFail(403, CODE_FORBIDDEN, ERR_FORBIDDEN);
  // 多人群照常提醒其他人 (发送者自己的设备按 by 认出是自己发的); 只有自己的群不响铃, 也不触发兜底推送
  const shared = !!grp && core.rooms.shared(grp);
  // 来源是人 (账号), 不是设备: 同一个人多台设备同一个来源, 名字取账号昵称
  const user = att.uid ? core.users.get(att.uid) : undefined;
  const source = att.uid
    ? { id: USER_SOURCE_PREFIX + att.uid, name: user?.display || user?.name || OWNER_NAME, type: SOURCE_TYPE_USER }
    : { id: att.device, name: OWNER_NAME, type: SOURCE_TYPE_USER };
  const ev = await core.pipeline.fromInput(input, { source, cid: frame.cid, ...(att.uid ? { by: att.uid } : {}) }, shared ? ROUTE_ROOM : ROUTE_SELF);
  sendFrame(ws, { t: "sent", cid: frame.cid, seq: ev.seq, ts: ev.ts });
  if (grp) core.presence.sent(grp, source.id);
}
