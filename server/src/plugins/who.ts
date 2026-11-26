import { agentOfKey } from "../agent-sync";
import type { Core, Principal } from "../core";

// 同一个请求里 acctOf 与 pluginOfKey 都要按 key 找群 Agent, 只找一次
const seen = new WeakMap<Principal, string | null>();
function keyPlugin(core: Core, who: Principal): string | null {
  if (who.owner || who.member) return null;
  if (!seen.has(who)) seen.set(who, agentOfKey(core, who.key.id)?.agent.plugin ?? null);
  return seen.get(who)!;
}

/** 请求落在哪个账号上: 主人与子号是自己; 插件 Agent 的 key 属于主人; 其他 key 没有账号。 */
export function acctOf(core: Core, who: Principal): string | null {
  if (who.owner) return who.user?.id ?? core.users.ownerId();
  if (who.member) return who.member.user.id;
  return keyPlugin(core, who) ? core.users.ownerId() : null;
}

/** 这把 key 是哪个插件的 Agent。 */
export const pluginOfKey = (core: Core, who: Principal): string | null => keyPlugin(core, who);

/** 管理员: 主人, 或角色为 admin 的账号 (子号身份进来的 admin 也算)。 */
export const isAdmin = (who: Principal): boolean => who.owner || who.member?.user.role === "admin";
