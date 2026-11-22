import { INVITE_PREFIX, type InviteCreated, type Me, type Role, type UserPublic } from "@hx-aioa/protocol";
import { randomSecret } from "../auth";
import { CODE_CONFLICT, CODE_FORBIDDEN, CODE_NOT_FOUND, ERR_FORBIDDEN } from "../constants";
import { ApiFail, clampInt, json } from "../http";
import {
  AUDIT_DEFAULT,
  AUDIT_MAX,
  ERR_GROUP_TAKEN,
  ERR_NEED_USER,
  ERR_NO_GROUP,
  ERR_NO_USER,
  ERR_OWNER_LOCKED,
  ERR_WRONG_OLD,
  INVITE_DEFAULT_HOURS,
  INVITE_MAX_HOURS,
  DISPLAY_MAX,
} from "./constants";
import { hashPassword, verifyPassword } from "./crypto";
import { canInvite, canManage, canSetRole, isAdmin, validName, validPassword } from "./rules";
import { type Body, str } from "./routes-public";
import type { Accounts } from "./service";

// 账号接口的调用者: 母号旧凭证 AUTH_TOKEN 没有会话, user 可能为空
export type AcctWho = { user: UserPublic | null; role: Role; session?: string; actor: string };

const forbidden = () => new ApiFail(403, CODE_FORBIDDEN, ERR_FORBIDDEN);
const noUser = () => new ApiFail(404, CODE_NOT_FOUND, ERR_NO_USER);
const needAdmin = (w: AcctWho) => {
  if (!isAdmin(w.role)) throw forbidden();
};
const needUser = (w: AcctWho): UserPublic => {
  if (!w.user) throw new ApiFail(400, "bad_request", ERR_NEED_USER);
  return w.user;
};

export function me(a: Accounts, w: AcctWho): Response {
  const user = needUser(w);
  const groups = a.dir.groups().filter((g) => g.members.includes(user.id));
  return json({ user, groups, devices: a.dir.sessions(user.id, w.session) } satisfies Me);
}

export async function logout(a: Accounts, w: AcctWho): Promise<Response> {
  const user = needUser(w);
  if (w.session && a.dir.deleteSession(w.session)) await a.kick(user, [w.session]);
  return json({ ok: true });
}

export async function changePassword(a: Accounts, w: AcctWho, b: Body): Promise<Response> {
  const user = needUser(w);
  if (!(await verifyPassword(str(b.old), a.dir.passOf(user.id) ?? ""))) throw new ApiFail(403, CODE_FORBIDDEN, ERR_WRONG_OLD);
  if (!validPassword(b.new)) throw new ApiFail(400, "bad_request", "新密码至少 8 位");
  a.dir.setPass(user.id, await hashPassword(b.new));
  await a.revokeAll(user, w.session);
  a.dir.audit(w.actor, "password", user.id);
  return json({ ok: true });
}

export async function dropDevice(a: Accounts, w: AcctWho, id: string): Promise<Response> {
  const user = needUser(w);
  if (!a.dir.sessions(user.id).some((s) => s.id === id)) throw new ApiFail(404, CODE_NOT_FOUND, "设备不存在");
  a.dir.deleteSession(id);
  await a.kick(user, [id]);
  a.dir.audit(w.actor, "revoke_device", user.id, id);
  return json({ ok: true });
}

export async function createInvite(a: Accounts, w: AcctWho, b: Body): Promise<Response> {
  needAdmin(w);
  const role = (str(b.role) || "member") as Role;
  if (!canInvite(w.role, role)) throw forbidden();
  const groups = (Array.isArray(b.groups) ? b.groups : []).map((g) => a.dir.group(String(g))?.id);
  if (groups.some((g) => !g)) throw new ApiFail(400, "bad_request", ERR_NO_GROUP);
  const hours = Math.min(typeof b.ttlHours === "number" && b.ttlHours > 0 ? b.ttlHours : INVITE_DEFAULT_HOURS, INVITE_MAX_HOURS);
  const code = randomSecret(INVITE_PREFIX);
  const now = Date.now();
  const info = await a.dir.createInvite(
    { role, groups: groups as string[], expires: now + hours * 3600_000, needsApproval: b.needsApproval === true, created: now, createdBy: w.user?.id ?? w.actor },
    code,
  );
  a.dir.audit(w.actor, "invite", info.id, role);
  return json({ ...info, code } satisfies InviteCreated);
}

export function listInvites(a: Accounts, w: AcctWho): Response {
  needAdmin(w);
  return json({ invites: a.dir.invites() });
}

export function dropInvite(a: Accounts, w: AcctWho, id: string): Response {
  needAdmin(w);
  if (!a.dir.deleteInvite(id)) throw new ApiFail(404, CODE_NOT_FOUND, "邀请不存在");
  a.dir.audit(w.actor, "drop_invite", id);
  return json({ ok: true });
}

function target(a: Accounts, w: AcctWho, id: string): UserPublic {
  needAdmin(w);
  const u = a.dir.find(id) ?? (() => { throw noUser(); })();
  if (u.role === "owner") throw new ApiFail(403, CODE_FORBIDDEN, ERR_OWNER_LOCKED);
  if (!canManage(w.role, u)) throw forbidden();
  return u;
}

export async function patchUser(a: Accounts, w: AcctWho, id: string, b: Body): Promise<Response> {
  const u = target(a, w, id);
  const next = { ...u };
  if (typeof b.display === "string" && b.display.trim()) next.display = b.display.trim().slice(0, DISPLAY_MAX);
  if (typeof b.role === "string" && b.role !== u.role) {
    if (!canSetRole(w.role, b.role as Role) || !["admin", "member"].includes(b.role)) throw forbidden();
    next.role = b.role as Role;
  }
  if (b.status === "active" || b.status === "disabled") next.status = b.status;
  a.dir.saveUser(next);
  if (next.status === "disabled" && u.status !== "disabled") await a.revokeAll(next);
  a.dir.audit(w.actor, "patch_user", u.id, JSON.stringify({ role: next.role, status: next.status }));
  return json(next);
}

export function approve(a: Accounts, w: AcctWho, id: string): Response {
  const u = target(a, w, id);
  const next: UserPublic = { ...u, status: "active" };
  a.dir.saveUser(next);
  a.dir.audit(w.actor, "approve", u.id);
  return json(next);
}

// 删号同时清空该用户 DO, 不可恢复
export async function deleteUser(a: Accounts, w: AcctWho, id: string): Promise<Response> {
  const u = target(a, w, id);
  await a.revokeAll(u);
  a.dir.deleteUser(u.id);
  await a.userHub(u).wipe();
  a.dir.audit(w.actor, "delete_user", u.id, u.name);
  return json({ ok: true });
}

export function listUsers(a: Accounts, w: AcctWho): Response {
  needAdmin(w);
  return json({ users: a.dir.users() });
}

export function audit(a: Accounts, w: AcctWho, url: URL): Response {
  needAdmin(w);
  return json({ entries: a.dir.auditLog(clampInt(url.searchParams.get("limit"), AUDIT_DEFAULT, AUDIT_MAX)) });
}

function members(a: Accounts, raw: unknown): string[] {
  const out: string[] = [];
  for (const m of Array.isArray(raw) ? raw : []) {
    const u = a.dir.find(String(m));
    if (!u) throw new ApiFail(400, "bad_request", `${ERR_NO_USER}: ${String(m)}`);
    if (!out.includes(u.id)) out.push(u.id);
  }
  return out;
}

export function listGroups(a: Accounts, w: AcctWho): Response {
  const all = a.dir.groups();
  return json({ groups: isAdmin(w.role) ? all : all.filter((g) => w.user && g.members.includes(w.user.id)) });
}

export function createGroup(a: Accounts, w: AcctWho, b: Body): Response {
  needAdmin(w);
  if (!validName(b.name)) throw new ApiFail(400, "bad_request", "群组名需为 2-32 位小写字母, 数字或 _ . -");
  if (a.dir.group(b.name)) throw new ApiFail(409, CODE_CONFLICT, ERR_GROUP_TAKEN);
  const g = a.dir.createGroup(b.name, (str(b.title) || b.name).slice(0, DISPLAY_MAX), members(a, b.members));
  a.dir.audit(w.actor, "create_group", g.id, g.name);
  return json(g);
}

export function patchGroup(a: Accounts, w: AcctWho, id: string, b: Body): Response {
  needAdmin(w);
  const g = a.dir.group(id) ?? (() => { throw new ApiFail(404, CODE_NOT_FOUND, ERR_NO_GROUP); })();
  const next = { ...g };
  if (typeof b.title === "string" && b.title.trim()) next.title = b.title.trim().slice(0, DISPLAY_MAX);
  if (b.members !== undefined) next.members = members(a, b.members);
  a.dir.saveGroup(next);
  a.dir.audit(w.actor, "patch_group", g.id);
  return json(next);
}

export function dropGroup(a: Accounts, w: AcctWho, id: string): Response {
  needAdmin(w);
  const g = a.dir.group(id);
  if (!g || !a.dir.deleteGroup(g.id)) throw new ApiFail(404, CODE_NOT_FOUND, ERR_NO_GROUP);
  a.dir.audit(w.actor, "drop_group", g.id, g.name);
  return json({ ok: true });
}
