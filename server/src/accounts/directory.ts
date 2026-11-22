import type { AuditEntry, DeviceInput, DeviceSession, GroupInfo, InviteInfo, Role, UserPublic, UserStatus } from "@hx-aioa/protocol";
import { randomId, sha256 } from "../auth";
import { DEVICE_UNNAMED, GROUP_ID_PREFIX, INVITE_ID_PREFIX, PLATFORM_UNKNOWN, REFRESH_TTL_MS, SESSION_ID_PREFIX, USER_ID_PREFIX } from "./constants";

type UserRow = { id: string; body: string; pass: string };
type SessionRow = { id: string; user: string; name: string; platform: string; created: number; seen: number; expires: number };
type BodyRow = { id: string; body: string };
type AuditRow = { id: number; ts: number; actor: string; action: string; target: string; detail: string | null };

const SESSION_COLS = "id, user, name, platform, created, seen, expires";

// 账号目录, 只存在于主 Hub; 子号的收件箱等数据在各自的 DO 里, 这里不碰
export class Directory {
  constructor(private readonly sql: SqlStorage) {
    sql.exec("CREATE TABLE IF NOT EXISTS acct_user (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, body TEXT NOT NULL, pass TEXT NOT NULL)");
    sql.exec(
      "CREATE TABLE IF NOT EXISTS acct_session (id TEXT PRIMARY KEY, user TEXT NOT NULL, refresh TEXT NOT NULL UNIQUE, name TEXT NOT NULL, platform TEXT NOT NULL, created INTEGER NOT NULL, seen INTEGER NOT NULL, expires INTEGER NOT NULL)",
    );
    sql.exec("CREATE TABLE IF NOT EXISTS acct_invite (id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, body TEXT NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS acct_group (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, body TEXT NOT NULL)");
    sql.exec(
      "CREATE TABLE IF NOT EXISTS acct_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, detail TEXT)",
    );
  }

  // ---- 用户 ----

  owner(): UserPublic | null {
    return this.users().find((u) => u.role === "owner") ?? null;
  }

  createUser(name: string, display: string, role: Role, status: UserStatus, pass: string): UserPublic {
    const user: UserPublic = { id: randomId(USER_ID_PREFIX, 5), name, display, role, status, created: Date.now() };
    this.sql.exec("INSERT INTO acct_user (id, name, body, pass) VALUES (?, ?, ?, ?)", user.id, name, JSON.stringify(user), pass);
    return user;
  }

  user(id: string): UserPublic | null {
    const row = this.sql.exec<UserRow>("SELECT id, body, pass FROM acct_user WHERE id = ?", id).toArray()[0];
    return row ? (JSON.parse(row.body) as UserPublic) : null;
  }

  // 用户 id 或用户名都可以
  find(ref: string): UserPublic | null {
    const row = this.sql.exec<UserRow>("SELECT id, body, pass FROM acct_user WHERE id = ? OR name = ?", ref, ref).toArray()[0];
    return row ? (JSON.parse(row.body) as UserPublic) : null;
  }

  withPass(name: string): { user: UserPublic; pass: string } | null {
    const row = this.sql.exec<UserRow>("SELECT id, body, pass FROM acct_user WHERE name = ?", name).toArray()[0];
    return row ? { user: JSON.parse(row.body) as UserPublic, pass: row.pass } : null;
  }

  passOf(id: string): string | null {
    return this.sql.exec<UserRow>("SELECT id, body, pass FROM acct_user WHERE id = ?", id).toArray()[0]?.pass ?? null;
  }

  users(): UserPublic[] {
    return this.sql.exec<UserRow>("SELECT id, body, pass FROM acct_user ORDER BY rowid").toArray().map((r) => JSON.parse(r.body) as UserPublic);
  }

  saveUser(user: UserPublic): void {
    this.sql.exec("UPDATE acct_user SET body = ? WHERE id = ?", JSON.stringify(user), user.id);
  }

  setPass(id: string, pass: string): void {
    this.sql.exec("UPDATE acct_user SET pass = ? WHERE id = ?", pass, id);
  }

  deleteUser(id: string): void {
    this.sql.exec("DELETE FROM acct_user WHERE id = ?", id);
    this.sql.exec("DELETE FROM acct_session WHERE user = ?", id);
    for (const g of this.groups()) if (g.members.includes(id)) this.saveGroup({ ...g, members: g.members.filter((m) => m !== id) });
  }

  // ---- 会话 ----

  async createSession(userId: string, device: DeviceInput | undefined, refresh: string, now = Date.now()): Promise<string> {
    const id = randomId(SESSION_ID_PREFIX, 5);
    const name = device?.name?.slice(0, 64) || DEVICE_UNNAMED;
    const platform = device?.platform?.slice(0, 32) || PLATFORM_UNKNOWN;
    this.sql.exec(
      "INSERT INTO acct_session (id, user, refresh, name, platform, created, seen, expires) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      id,
      userId,
      await sha256(refresh),
      name,
      platform,
      now,
      now,
      now + REFRESH_TTL_MS,
    );
    return id;
  }

  session(id: string): SessionRow | null {
    return this.sql.exec<SessionRow>(`SELECT ${SESSION_COLS} FROM acct_session WHERE id = ?`, id).toArray()[0] ?? null;
  }

  async sessionByRefresh(refresh: string): Promise<SessionRow | null> {
    return this.sql.exec<SessionRow>(`SELECT ${SESSION_COLS} FROM acct_session WHERE refresh = ?`, await sha256(refresh)).toArray()[0] ?? null;
  }

  // 刷新令牌每次轮换, 旧的立即失效
  async rotate(id: string, refresh: string, now = Date.now()): Promise<void> {
    this.sql.exec("UPDATE acct_session SET refresh = ?, seen = ?, expires = ? WHERE id = ?", await sha256(refresh), now, now + REFRESH_TTL_MS, id);
  }

  sessions(userId: string, current?: string): DeviceSession[] {
    return this.sql
      .exec<SessionRow>(`SELECT ${SESSION_COLS} FROM acct_session WHERE user = ? ORDER BY created`, userId)
      .toArray()
      .map((r) => ({ id: r.id, name: r.name, platform: r.platform, created: r.created, seen: r.seen, ...(r.id === current ? { current: true } : {}) }));
  }

  deleteSession(id: string): boolean {
    return this.sql.exec("DELETE FROM acct_session WHERE id = ?", id).rowsWritten > 0;
  }

  // 返回被删除的会话 id, 用来断开它们的长连接
  deleteSessions(userId: string, except?: string): string[] {
    const ids = this.sessions(userId).map((s) => s.id).filter((id) => id !== except);
    for (const id of ids) this.deleteSession(id);
    return ids;
  }

  // ---- 邀请 ----

  async createInvite(info: Omit<InviteInfo, "id">, code: string): Promise<InviteInfo> {
    const full: InviteInfo = { id: randomId(INVITE_ID_PREFIX, 5), ...info };
    this.sql.exec("INSERT INTO acct_invite (id, hash, body) VALUES (?, ?, ?)", full.id, await sha256(code), JSON.stringify(full));
    return full;
  }

  async inviteByCode(code: string): Promise<InviteInfo | null> {
    const row = this.sql.exec<BodyRow>("SELECT id, body FROM acct_invite WHERE hash = ?", await sha256(code)).toArray()[0];
    return row ? (JSON.parse(row.body) as InviteInfo) : null;
  }

  invites(): InviteInfo[] {
    return this.sql.exec<BodyRow>("SELECT id, body FROM acct_invite ORDER BY rowid").toArray().map((r) => JSON.parse(r.body) as InviteInfo);
  }

  deleteInvite(id: string): boolean {
    return this.sql.exec("DELETE FROM acct_invite WHERE id = ?", id).rowsWritten > 0;
  }

  // ---- 群组 ----

  createGroup(name: string, title: string, members: string[]): GroupInfo {
    const g: GroupInfo = { id: randomId(GROUP_ID_PREFIX, 5), name, title, members };
    this.sql.exec("INSERT INTO acct_group (id, name, body) VALUES (?, ?, ?)", g.id, name, JSON.stringify(g));
    return g;
  }

  group(ref: string): GroupInfo | null {
    const row = this.sql.exec<BodyRow>("SELECT id, body FROM acct_group WHERE id = ? OR name = ?", ref, ref).toArray()[0];
    return row ? (JSON.parse(row.body) as GroupInfo) : null;
  }

  groups(): GroupInfo[] {
    return this.sql.exec<BodyRow>("SELECT id, body FROM acct_group ORDER BY rowid").toArray().map((r) => JSON.parse(r.body) as GroupInfo);
  }

  saveGroup(g: GroupInfo): void {
    this.sql.exec("UPDATE acct_group SET body = ? WHERE id = ?", JSON.stringify(g), g.id);
  }

  deleteGroup(id: string): boolean {
    return this.sql.exec("DELETE FROM acct_group WHERE id = ?", id).rowsWritten > 0;
  }

  // ---- 审计 ----

  audit(actor: string, action: string, target: string, detail?: string): void {
    this.sql.exec("INSERT INTO acct_audit (ts, actor, action, target, detail) VALUES (?, ?, ?, ?, ?)", Date.now(), actor, action, target, detail ?? null);
  }

  auditLog(limit: number): AuditEntry[] {
    return this.sql
      .exec<AuditRow>("SELECT id, ts, actor, action, target, detail FROM acct_audit ORDER BY id DESC LIMIT ?", limit)
      .toArray()
      .map((r) => ({ id: r.id, ts: r.ts, actor: r.actor, action: r.action, target: r.target, ...(r.detail ? { detail: r.detail } : {}) }));
  }
}
