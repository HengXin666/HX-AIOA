import { OFFICIAL_SOURCE, type MarketSource } from "@hx-aioa/protocol";
import type { Core } from "../core";
import { pushPlugin } from "./notify";

/** 白名单里记的是官方源 (旧数据没有 source 也算) 的非开发插件。 */
function fromOfficial(core: Core, id: string): boolean {
  const m = core.kernel.get(id)?.meta;
  return !!m && !m.dev && (m.source ?? OFFICIAL_SOURCE) === OFFICIAL_SOURCE;
}

/** 换源迁移: 白名单改记私有源并标私有, 主人以外的账号停用 (数据保留) 并推给他们。 */
export function relocateTo(core: Core, id: string, src: MarketSource): void {
  if (!src.private || !fromOfficial(core, id)) return;
  for (const uid of core.kernel.relocate(id, src.id, true, core.users.ownerId())) pushPlugin(core, id, "disabled", { uid });
}

/**
 * 官方源下架, 主人私有源接手同 id 时 (#124): 就地把白名单的源改成私有源。
 * 快照, 版本, 主人的启用, 安装记录, 插件数据都不动, 不撤销不拆除; 新版本照常由主人看详情后放行。
 * 只在主人的请求里做 (只有主人看得到私有源), 按缓存判断, 不多拉。返回迁移了的 id。
 */
export async function relocateOfficial(core: Core): Promise<string[]> {
  const ids = core.kernel.list().filter((a) => fromOfficial(core, a.id)).map((a) => a.id);
  const moved = await core.market.movedToPrivate(ids);
  for (const [id, src] of moved) relocateTo(core, id, src);
  return [...moved.keys()];
}

/** 单个插件的换源迁移 (看详情, 放行时用)。 */
export async function relocateMoved(core: Core, id: string): Promise<void> {
  for (const [i, src] of await core.market.movedToPrivate([id])) relocateTo(core, i, src);
}
