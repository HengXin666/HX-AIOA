import { GH_PLUGIN_ID, GITHUB_PLUGIN, HXOA_PLUGIN, TODO_PLUGIN, isL2a, type L2aPlugin } from "@hx-aioa/protocol";
import type { Core } from "../core";

/**
 * 服务端插件 (L2a) 登记表: 代码编进部署, 门控只查内核内存里主人或调用者的启用状态。
 * owner: 数据属于整个部署 (一个令牌), 只看主人的启用; 否则按调用者账号 (个人归属)。
 * purge: 停用带 ?purge=1 时清掉的部署级数据 (pdata 另由内核清)。
 */
type L2a = { owner: boolean; purge?: (core: Core) => number | Promise<number> };

export const L2A: Record<L2aPlugin, L2a> = {
  [TODO_PLUGIN]: { owner: false },
  [GITHUB_PLUGIN]: { owner: true, purge: (core) => core.github.purge() },
  [GH_PLUGIN_ID]: { owner: true, purge: (core) => core.gh.purge() },
  [HXOA_PLUGIN]: { owner: true, purge: (core) => core.hxoa.purge() },
};

/** 停用并清除: 部署级数据只有主人停用时才清。 */
export async function purgeL2a(core: Core, uid: string, id: string): Promise<number> {
  if (!isL2a(id) || uid !== core.users.ownerId()) return 0;
  return (await L2A[id].purge?.(core)) ?? 0;
}
