import { ROOM_INVITE_PREFIX, type DeviceInput, type JoinResult, type Role, type UserStatus } from "@hx-aioa/protocol";
import { safeEqual } from "../auth";
import { CODE_CONFLICT, CODE_EXPIRED, CODE_FORBIDDEN, CODE_NOT_CONFIGURED, CODE_UNAUTHORIZED } from "../constants";
import { ApiFail, json } from "../http";
import {
  DISPLAY_MAX,
  ERR_BAD_INVITE,
  ERR_BAD_LOGIN,
  ERR_BAD_NAME,
  ERR_BAD_PASSWORD,
  ERR_BAD_SETUP_CODE,
  ERR_DISABLED,
  ERR_INVITE_EXPIRED,
  ERR_NAME_TAKEN,
  ERR_NEED_SETUP_CODE,
  ERR_PENDING,
  ERR_SETUP_DONE,
} from "./constants";
import { hashPassword, verifyPassword } from "./crypto";
import type { Accounts } from "./service";
import { validName, validPassword } from "./rules";

export type Body = Record<string, unknown>;

export const str = (v: unknown) => (typeof v === "string" ? v : "");
export const display = (b: Body, name: string) => (str(b.display).trim() || name).slice(0, DISPLAY_MAX);

export function device(b: Body): DeviceInput | undefined {
  const d = b.device;
  if (typeof d !== "object" || d === null) return undefined;
  const o = d as Body;
  return { name: str(o.name), platform: str(o.platform) };
}

export function checkCredentials(b: Body): { name: string; password: string } {
  if (!validName(b.name)) throw new ApiFail(400, "bad_request", ERR_BAD_NAME);
  if (!validPassword(b.password)) throw new ApiFail(400, "bad_request", ERR_BAD_PASSWORD);
  return { name: b.name, password: b.password };
}

export async function setup(a: Accounts, code: string | undefined, b: Body): Promise<Response> {
  if (!code) throw new ApiFail(503, CODE_NOT_CONFIGURED, ERR_NEED_SETUP_CODE);
  a.secret();
  if (a.dir.owner()) throw new ApiFail(409, CODE_CONFLICT, ERR_SETUP_DONE);
  if (!safeEqual(str(b.code), code)) throw new ApiFail(403, CODE_FORBIDDEN, ERR_BAD_SETUP_CODE);
  const { name, password } = checkCredentials(b);
  const user = a.dir.createUser(name, display(b, name), "owner", "active", await hashPassword(password));
  a.dir.audit(user.id, "setup", user.id);
  return json(await a.issue(user, device(b)));
}

export async function login(a: Accounts, b: Body): Promise<Response> {
  const name = str(b.name);
  a.checkThrottle(name.toLowerCase());
  const row = a.dir.withPass(name);
  if (!row || !(await verifyPassword(str(b.password), row.pass))) {
    a.recordFail(name.toLowerCase());
    throw new ApiFail(401, CODE_UNAUTHORIZED, ERR_BAD_LOGIN);
  }
  if (row.user.status === "pending") throw new ApiFail(403, CODE_FORBIDDEN, ERR_PENDING);
  if (row.user.status === "disabled") throw new ApiFail(403, CODE_FORBIDDEN, ERR_DISABLED);
  a.clearFails(name.toLowerCase());
  return json(await a.issue(row.user, device(b)));
}

// 群邀请链接: 注册成普通成员并直接进群, 不需要审批; 邀请码先校验, 建号成功后才记一次使用
async function joinByRoom(a: Accounts, b: Body, code: string): Promise<Response> {
  const { name, password } = checkCredentials(b);
  if (a.dir.find(name)) throw new ApiFail(409, CODE_CONFLICT, ERR_NAME_TAKEN);
  if (!a.joinRoom) throw new ApiFail(404, "not_found", ERR_BAD_INVITE);
  const user = a.dir.createUser(name, display(b, name), "member", "active", await hashPassword(password));
  try {
    await a.joinRoom(user.id, code);
  } catch (e) {
    a.dir.deleteUser(user.id);
    throw e;
  }
  a.dir.audit(user.id, "join", user.id, "room");
  return json(await a.issue(user, device(b)));
}

// 邀请一次性: 先作废再建号, 建号失败也不能复用
export async function join(a: Accounts, b: Body): Promise<Response> {
  a.secret();
  const code = str(b.code).trim();
  if (code.startsWith(ROOM_INVITE_PREFIX)) return joinByRoom(a, b, code);
  const invite = await a.dir.inviteByCode(str(b.code));
  if (!invite) throw new ApiFail(404, "not_found", ERR_BAD_INVITE);
  if (invite.expires <= Date.now()) {
    a.dir.deleteInvite(invite.id);
    throw new ApiFail(410, CODE_EXPIRED, ERR_INVITE_EXPIRED);
  }
  const { name, password } = checkCredentials(b);
  if (a.dir.find(name)) throw new ApiFail(409, CODE_CONFLICT, ERR_NAME_TAKEN);
  a.dir.deleteInvite(invite.id);
  const status: UserStatus = invite.needsApproval ? "pending" : "active";
  const user = a.dir.createUser(name, display(b, name), invite.role as Role, status, await hashPassword(password));
  for (const gid of invite.groups) {
    const g = a.dir.group(gid);
    if (g && !g.members.includes(user.id)) a.dir.saveGroup({ ...g, members: [...g.members, user.id] });
  }
  a.dir.audit(user.id, "join", user.id, invite.id);
  if (status === "pending") return json({ pending: true, user } satisfies JoinResult);
  return json(await a.issue(user, device(b)));
}
