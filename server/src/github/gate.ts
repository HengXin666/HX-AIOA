import { GITHUB_PLUGIN } from "@hx-aioa/protocol";
import { CODE_NOT_FOUND, ERR_NOT_FOUND } from "../constants";
import type { Core, Handler } from "../core";
import { fail } from "../http";

/** GitHub 数据属于整个部署 (一个 GITHUB_TOKEN), 跟主人的启用状态走; 只查内核内存, 不查库。 */
export const githubOn = (core: Core): boolean => core.kernel.isEnabled(core.users.ownerId(), GITHUB_PLUGIN);

/** 主人没启用时当接口不存在; 先读掉请求体, 免得 workerd 报请求流未读完。 */
export async function githubOff(req: Request): Promise<Response> {
  if (req.body && !req.bodyUsed) await req.arrayBuffer().catch(() => undefined);
  return fail(404, ERR_NOT_FOUND, CODE_NOT_FOUND);
}

export const gated = (h: Handler): Handler => (c) => (githubOn(c.core) ? h(c) : githubOff(c.req));

/** 停用并清除数据: 只有主人停用 GitHub 插件时才清 (数据属于部署)。 */
export async function purgeBuiltin(core: Core, uid: string, id: string): Promise<number> {
  return id === GITHUB_PLUGIN && uid === core.users.ownerId() ? core.github.purge() : 0;
}
