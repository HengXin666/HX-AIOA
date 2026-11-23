import { ROOM_INVITE_PREFIX, type ChatPatch, type RoomRole } from "@hx-aioa/protocol";
import { randomSecret, sha256 } from "./auth";

type MemberRow = { grp: string; member: string; role: string; joined: number; prefs: string | null };
type InviteRow = { hash: string; grp: string; expires: number; uses: number; max: number };
export type MemberPrefs = Pick<ChatPatch, "pinned" | "muted" | "read">;
export type Membership = { grp: string; member: string; role: Exclude<RoomRole, "owner">; joined: number; prefs: MemberPrefs };
export type InviteCheck = { grp: string } | "missing" | "expired";

// 多人群的成员与邀请, 与消息同在主库; 主键都以 grp 开头, 按群查走索引
export class RoomStore {
  constructor(private readonly sql: SqlStorage) {
    sql.exec(
      "CREATE TABLE IF NOT EXISTS room_member (grp TEXT NOT NULL, member TEXT NOT NULL, role TEXT NOT NULL, joined INTEGER NOT NULL, prefs TEXT, PRIMARY KEY (grp, member)) WITHOUT ROWID",
    );
    sql.exec("CREATE INDEX IF NOT EXISTS room_member_by_user ON room_member (member)");
    sql.exec("CREATE TABLE IF NOT EXISTS room_invite (hash TEXT PRIMARY KEY, grp TEXT NOT NULL, expires INTEGER NOT NULL, uses INTEGER NOT NULL, max INTEGER NOT NULL)");
  }

  members(grp: string): Membership[] {
    return this.sql.exec<MemberRow>("SELECT * FROM room_member WHERE grp = ? ORDER BY joined", grp).toArray().map(toMembership);
  }

  member(grp: string, uid: string): Membership | null {
    const r = this.sql.exec<MemberRow>("SELECT * FROM room_member WHERE grp = ? AND member = ?", grp, uid).toArray()[0];
    return r ? toMembership(r) : null;
  }

  // 有成员的群才是多人群, 只有自己的群不在表里
  shared(grp: string): boolean {
    return this.sql.exec("SELECT 1 FROM room_member WHERE grp = ? LIMIT 1", grp).toArray().length > 0;
  }

  count(grp: string): number {
    return this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM room_member WHERE grp = ?", grp).one().n;
  }

  roomsOf(uid: string): Membership[] {
    return this.sql.exec<MemberRow>("SELECT * FROM room_member WHERE member = ?", uid).toArray().map(toMembership);
  }

  add(grp: string, uid: string, role: Exclude<RoomRole, "owner">, now = Date.now()): void {
    this.sql.exec("INSERT INTO room_member (grp, member, role, joined) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING", grp, uid, role, now);
  }

  setRole(grp: string, uid: string, role: Exclude<RoomRole, "owner">): boolean {
    return this.sql.exec("UPDATE room_member SET role = ? WHERE grp = ? AND member = ?", role, grp, uid).rowsWritten > 0;
  }

  remove(grp: string, uid: string): boolean {
    return this.sql.exec("DELETE FROM room_member WHERE grp = ? AND member = ?", grp, uid).rowsWritten > 0;
  }

  // 删号时退出所有群
  forget(uid: string): void {
    this.sql.exec("DELETE FROM room_member WHERE member = ?", uid);
  }

  // 成员自己的置顶, 免打扰, 已读; 已读只前进
  patchPrefs(grp: string, uid: string, patch: MemberPrefs): MemberPrefs {
    const cur = this.member(grp, uid)?.prefs ?? {};
    const next: MemberPrefs = { ...cur };
    if (patch.pinned !== undefined) next.pinned = patch.pinned;
    if (patch.muted !== undefined) next.muted = patch.muted;
    if (patch.read !== undefined && patch.read > (cur.read ?? 0)) next.read = patch.read;
    this.sql.exec("UPDATE room_member SET prefs = ? WHERE grp = ? AND member = ?", JSON.stringify(next), grp, uid);
    return next;
  }

  async createInvite(grp: string, ttlMs: number, max: number, now = Date.now()): Promise<{ code: string; expires: number }> {
    const code = randomSecret(ROOM_INVITE_PREFIX);
    const expires = now + ttlMs;
    this.sql.exec("DELETE FROM room_invite WHERE expires <= ?", now);
    this.sql.exec("INSERT INTO room_invite (hash, grp, expires, uses, max) VALUES (?, ?, ?, 0, ?)", await sha256(code), grp, expires, max);
    return { code, expires };
  }

  async checkInvite(code: string, now = Date.now()): Promise<InviteCheck> {
    const r = this.sql.exec<InviteRow>("SELECT * FROM room_invite WHERE hash = ?", await sha256(code)).toArray()[0];
    if (!r) return "missing";
    if (r.expires <= now || r.uses >= r.max) return "expired";
    return { grp: r.grp };
  }

  // 用满的留到过期再清, 期间打开链接能提示 "已用完" 而不是 "无效"
  async useInvite(code: string): Promise<void> {
    this.sql.exec("UPDATE room_invite SET uses = uses + 1 WHERE hash = ?", await sha256(code));
  }

  dropRoom(grp: string): void {
    this.sql.exec("DELETE FROM room_member WHERE grp = ?", grp);
    this.sql.exec("DELETE FROM room_invite WHERE grp = ?", grp);
  }
}

function toMembership(r: MemberRow): Membership {
  return { grp: r.grp, member: r.member, role: r.role === "admin" ? "admin" : "member", joined: r.joined, prefs: r.prefs ? (JSON.parse(r.prefs) as MemberPrefs) : {} };
}
