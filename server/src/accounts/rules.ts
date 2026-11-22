import type { Role, UserPublic } from "@hx-aioa/protocol";
import { NAME_RE, PASSWORD_MAX, PASSWORD_MIN } from "./constants";

// 纯函数: 权限与输入校验, 便于单测

export const validName = (name: unknown): name is string => typeof name === "string" && NAME_RE.test(name);
export const validPassword = (p: unknown): p is string => typeof p === "string" && p.length >= PASSWORD_MIN && p.length <= PASSWORD_MAX;
export const isAdmin = (role: Role) => role === "owner" || role === "admin";

// admin 只能管理 member; owner 能管理除自己以外的所有人
export function canManage(actor: Role, target: UserPublic): boolean {
  if (target.role === "owner") return false;
  if (actor === "owner") return true;
  return actor === "admin" && target.role === "member";
}

// admin 只能邀请 member, owner 可以邀请 admin
export function canInvite(actor: Role, role: Role): boolean {
  if (role === "owner") return false;
  if (actor === "owner") return true;
  return actor === "admin" && role === "member";
}

// 改角色仅 owner, 且不能把人提成 owner
export function canSetRole(actor: Role, role: Role): boolean {
  return actor === "owner" && role !== "owner";
}
