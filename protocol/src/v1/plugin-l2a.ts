import { GH_PLUGIN_ID } from "./gh";
import { GITHUB_PLUGIN } from "./github";
import { HXOA_PLUGIN } from "./plugin-hxoa";
import { TODO_PLUGIN } from "./plugin-todo";

// 这次部署编进去的服务端插件代码 (L2a); 清单写 "server": true 的必须在这里, 反之亦然, 市场 CI 校验
export const L2A_PLUGINS = [TODO_PLUGIN, GITHUB_PLUGIN, GH_PLUGIN_ID, HXOA_PLUGIN] as const;
export type L2aPlugin = (typeof L2A_PLUGINS)[number];
export const isL2a = (id: string): id is L2aPlugin => (L2A_PLUGINS as readonly string[]).includes(id);
// 放行带服务端代码但这次部署里没有的插件
export const CODE_NEEDS_DEPLOY = "plugin_needs_deploy";
