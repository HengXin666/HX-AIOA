import { GH_PLUGIN_ID, GH_SERVICE, type PluginManifest } from "@hx-aioa/protocol";
import type { Core, Handler } from "../core";
import { githubOff } from "../github/gate";

/** GitHub 授权只有一份 (主人的令牌), 跟主人的启用状态走; 只查内核内存, 不查库。 */
export const ghOn = (core: Core): boolean => core.kernel.isEnabled(core.users.ownerId(), GH_PLUGIN_ID);

/** 主人没启用 GitHub 授权插件时, /api/v1/gh/* 当作不存在。 */
export const ghGated = (h: Handler): Handler => (c) => (ghOn(c.core) ? h(c) : githubOff(c.req));

const declares = (m: PluginManifest | undefined): boolean => !!m && (Object.hasOwn(m.requires ?? {}, GH_SERVICE) || Object.hasOwn(m.optional ?? {}, GH_SERVICE) || !!m.deps?.some((d) => d.id === GH_PLUGIN_ID));

/** 插件清单 (白名单快照) 声明了要用 GitHub issue 服务, 且主人启用了 GitHub 授权。 */
export const usesGh = (core: Core, pluginId: string): boolean => ghOn(core) && declares(core.kernel.get(pluginId)?.manifest);
