import type { Core } from "../core";

/** 私有插件只给主人: 放行时记在白名单上 (源被删也算), 或者来自现存的私有源。 */
export function privatePlugin(core: Core, id: string, source?: string): boolean {
  const meta = core.kernel.get(id)?.meta;
  return !!meta?.private || core.market.isPrivate(source ?? meta?.source);
}
