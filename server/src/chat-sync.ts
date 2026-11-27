import type { AgentActiveFrame, ChatMeta, ChatReadFrame, ChatSyncFrame } from "@hx-aioa/protocol";
import type { Core } from "./core";
import { memberView, ownerSees, ownerView } from "./room-access";

const TOPIC = "chats";

/**
 * 群资料变了: 带上收帧人视图下的整份资料, 只发给群成员与主人 (#129)。
 * also: 刚被移出 / 群被删的人, 发不带资料的帧让他们重拉; ownerOnly: 只改了主人私有的字段 (Agent)。
 */
export function syncChat(core: Core, channel: string, opt: { also?: string[]; ownerOnly?: boolean } = {}): void {
  const meta = core.chats.chat(channel);
  const bare = { t: "chat_sync", topic: TOPIC, channel } satisfies ChatSyncFrame;
  const members = opt.ownerOnly ? [] : core.rooms.members(channel).map((m) => m.member);
  const gone = new Set(opt.also ?? []);
  core.sockets.toEach([...members, ...gone], (uid) => {
    if (uid === null) {
      if (!ownerSees(core, channel)) return null;
      return meta && !meta.deleted ? { ...bare, chat: ownerView(core, meta) } : bare;
    }
    const chat: ChatMeta | null = gone.has(uid) ? null : memberView(core, channel, uid);
    return chat ? { ...bare, chat } : bare;
  });
}

/** 子号只改了自己的置顶 / 免打扰: 只推给他自己的设备。 */
export function syncSelf(core: Core, channel: string, uid: string): void {
  const chat = memberView(core, channel, uid);
  core.sockets.toUser(uid, core.users.ownerId(), { t: "chat_sync", topic: TOPIC, channel, ...(chat ? { chat } : {}) } satisfies ChatSyncFrame);
}

/** 已读只推给本人的设备, 不改群资料也不让别人重拉。 */
export function pushRead(core: Core, uid: string, channel: string, read: number): void {
  core.sockets.toUser(uid, core.users.ownerId(), { t: "chat_read", channel, read } satisfies ChatReadFrame);
}

/** Agent 活跃变了: 推给主人的设备 (Agent 资料只有主人看得到)。 */
export function pushActive(core: Core, channel: string, keyId: string, active: number): void {
  core.sockets.toV1Clients({ t: "agent_active", channel, keyId, active } satisfies AgentActiveFrame);
}
