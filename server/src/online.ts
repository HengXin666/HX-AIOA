import type { OnlineFrame } from "@hx-aioa/protocol";
import type { Core } from "./core";

/**
 * 真人在线 (#139, 规范 §3): 只走长连接帧, 不再要客户端发请求问。
 * 前台连接连上 / 全断开时, 推一帧给和他同群的人 (主人总能收到); 新连上的客户端先收一帧全量。
 */
export function peersOf(core: Core, uid: string): Set<string> {
  const owner = core.users.ownerId();
  const grps = uid === owner ? core.rooms.sharedGroups() : core.rooms.roomsOf(uid).map((m) => m.grp);
  const out = new Set<string>();
  for (const g of grps) for (const m of core.rooms.members(g)) out.add(m.member);
  out.add(owner);
  out.delete(uid);
  return out;
}

/** uid 的前台连接上了 (on) 或最后一条断开了。 */
export function onlineChanged(core: Core, uid: string, on: boolean, now = Date.now()): void {
  const frame: OnlineFrame = on ? { t: "online", online: [uid], seen: {} } : { t: "online", online: [], seen: { [uid]: now } };
  core.sockets.toChannel(peersOf(core, uid), frame);
}

/** 给刚连上的 uid 一帧全量: 同群的人谁在线, 不在线的最近什么时候在。 */
export function onlineSnapshot(core: Core, uid: string, now = Date.now()): OnlineFrame {
  const owner = core.users.ownerId();
  const live = core.sockets.onlineUids(owner);
  const out: OnlineFrame = { t: "online", full: true, online: [], seen: {} };
  for (const id of peersOf(core, uid)) {
    if (live.has(id)) {
      out.online.push(id);
      continue;
    }
    const at = Math.min(now, Math.max(core.sockets.leftAt(id, owner), core.users.seen?.(id) ?? 0));
    if (at > 0) out.seen[id] = at;
  }
  return out;
}
