import { MEMBERS_DEFAULT_LIMIT, MEMBERS_MAX_LIMIT, QUERY_CURSOR, QUERY_LIMIT, QUERY_Q, dmPeers, type RoomMember, type RoomMembers, type RoomRole, type UserPublic } from "@hx-aioa/protocol";
import type { Core, ReqCtx } from "./core";
import { clampInt, etagged } from "./http";
import { mustRole } from "./room-access";
import type { Membership } from "./rooms";

type After = { joined: number; member: string };

function brief(u: UserPublic, role: RoomRole, joined: number): RoomMember {
  return { id: u.id, name: u.name, display: u.display || u.name, role, joined, ...(u.avatar ? { avatar: u.avatar } : {}) };
}

// cursor 形如 "<joined>_<账号 id>", 是上一页最后一个成员
function parseCursor(raw: string): After | null {
  const i = raw.indexOf("_");
  const joined = Number(raw.slice(0, i));
  return i > 0 && Number.isSafeInteger(joined) ? { joined, member: raw.slice(i + 1) } : null;
}

const cursorOf = (m: Membership) => `${m.joined}_${m.member}`;
const hit = (u: UserPublic, q: string) => !q || u.name.toLowerCase().includes(q) || (u.display || "").toLowerCase().includes(q);
const later = (m: Membership, a: After | null) => !a || m.joined > a.joined || (m.joined === a.joined && m.member > a.member);

/** 一页成员: 群主 (主人) 只在第一页最前面; 单聊里主人不是一方时不列出。q 按用户名与昵称过滤。 */
export function membersPage(core: Core, grp: string, q: string, after: After | null, limit: number): RoomMembers {
  const ownerId = core.users.ownerId();
  const pair = dmPeers(grp);
  const owner = !after && (!pair || pair.includes(ownerId)) ? core.users.get(ownerId) : null;
  const out: RoomMember[] = owner && hit(owner, q) ? [brief(owner, pair ? "member" : "owner", 0)] : [];
  const want = Math.max(1, limit - out.length);
  // 不搜索时直接按键翻页; 搜索要看账号名字, 只能整群过一遍 (群一般不大)
  const rows = q ? core.rooms.members(grp).filter((m) => later(m, after)) : core.rooms.page(grp, after, want + 1);
  let taken = 0;
  let last: Membership | null = null;
  let more = false;
  for (const m of rows) {
    const u = core.users.get(m.member);
    if (!u || !hit(u, q)) {
      last = m;
      continue;
    }
    if (taken === want) {
      more = true;
      break;
    }
    out.push(brief(u, m.role, m.joined));
    taken += 1;
    last = m;
  }
  if (!q && rows.length > want) more = true;
  return { members: out, ...(more && last ? { next: cursorOf(last) } : {}) };
}

/** GET /chats/{c}/members?cursor=&limit=&q= (#130): ETag 为成员数 + 群资料版本 (成员变动与成员改头像都会让它 +1)。 */
export function listMembers(c: ReqCtx): Response {
  const grp = decodeURIComponent(c.params[0] ?? "");
  mustRole(c.core, c.who, grp, "member");
  const sp = c.url.searchParams;
  const q = (sp.get(QUERY_Q) ?? "").trim().toLowerCase();
  const limit = Math.max(1, clampInt(sp.get(QUERY_LIMIT), MEMBERS_DEFAULT_LIMIT, MEMBERS_MAX_LIMIT));
  const after = parseCursor(sp.get(QUERY_CURSOR) ?? "");
  const tag = `${c.core.rooms.count(grp)}-${c.core.chats.revOf(grp)}`;
  return etagged(c.req, tag, () => membersPage(c.core, grp, q, after, limit));
}
