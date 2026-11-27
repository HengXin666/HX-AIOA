import { OFFICIAL_SOURCE } from "@hx-aioa/protocol";
import type { Core } from "../core";

/** 私有插件只给主人: 放行时记在白名单上 (源被删也算), 或者来自现存的私有源。 */
export function privatePlugin(core: Core, id: string, source?: string): boolean {
  const meta = core.kernel.get(id)?.meta;
  return !!meta?.private || core.market.isPrivate(source ?? meta?.source);
}

/** 可信来源 (#139, 能让空间声明 tab: "primary"): 官方源 (旧数据没记源也算) 与主人私有源; 开发模式与第三方源不算。 */
export function trustedPlugin(core: Core, id: string): boolean {
  const meta = core.kernel.get(id)?.meta;
  if (!meta || meta.dev) return false;
  return (meta.source ?? OFFICIAL_SOURCE) === OFFICIAL_SOURCE || privatePlugin(core, id);
}
