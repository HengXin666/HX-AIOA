import { agentOfKey } from "../agent-sync";
import type { Core, Principal } from "../core";

/** 请求落在哪个账号上: 主人与子号是自己; 插件 Agent 的 key 属于主人; 其他 key 没有账号。 */
export function acctOf(core: Core, who: Principal): string | null {
  if (who.owner) return who.user?.id ?? core.users.ownerId();
  if (who.member) return who.member.user.id;
  return agentOfKey(core, who.key.id)?.agent.plugin ? core.users.ownerId() : null;
}

/** 这把 key 是哪个插件的 Agent。 */
export function pluginOfKey(core: Core, who: Principal): string | null {
  if (who.owner || who.member) return null;
  return agentOfKey(core, who.key.id)?.agent.plugin ?? null;
}

/** 管理员: 主人, 或角色为 admin 的账号 (子号身份进来的 admin 也算)。 */
export const isAdmin = (who: Principal): boolean => who.owner || who.member?.user.role === "admin";
