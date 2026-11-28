// 插件 (#167, 对照安卓 settings/PluginApi.kt): 市场内容由服务端去仓库拉, Web 只和自己的服务端说话。
// 列表与贡献接口带上 client=web&cb=<构建号>, 服务端据此给每项算按端兼容 (#156)。
import {
  isRisky,
  PATH_PLUGIN,
  PATH_PLUGIN_ALLOW,
  PATH_PLUGIN_ALLOW_LIST,
  PATH_PLUGIN_CHOICE,
  PATH_PLUGIN_DEV,
  PATH_PLUGIN_DEV_MODE,
  PATH_PLUGIN_ENABLED,
  PATH_PLUGIN_INSTALL,
  PATH_PLUGIN_UPDATE,
  PATH_PLUGINS,
  QUERY_CLIENT,
  QUERY_CLIENT_BUILD,
  type PluginAllowView,
  type PluginDetail,
  type PluginInstalled,
  type PluginList,
} from "@hx-aioa/protocol";
import { useEffect, useState } from "react";
import { api, fill } from "./auth";
import { Emitter } from "./emitter";
import { link } from "./link";

export type PluginItem = PluginList["plugins"][number];
export type Detail = PluginDetail & {
  enabled: boolean;
  choices: Record<string, string>;
  risky: string[];
  singles: string[];
};

const PUT = "PUT";
const DELETE = "DELETE";
const POST = "POST";
const SINGLE_PREFIX = "core.";
const client = () =>
  `${QUERY_CLIENT}=web&${QUERY_CLIENT_BUILD}=${__WEB_BUILD__.web}`;
const send = (path: string, method: string, body?: unknown) =>
  api<unknown>(path, {
    method,
    ...(body === undefined
      ? {}
      : {
          body: JSON.stringify(body),
          headers: { "content-type": "application/json" },
        }),
  });

/** 放行, 撤销, 启用, 换版本时服务端推 plugin_update; 页面据此重拉 */
export const pluginsChanged = new Emitter<string>();
let attached = false;
function attach() {
  if (attached) return;
  attached = true;
  link.frames.on((f) => {
    if (f.t === "plugin_update" && typeof f.id === "string")
      pluginsChanged.emit(f.id);
  });
}

/** 变更计数: 每次推送或本页操作后 +1, 给 useEffect 当依赖 */
export function usePluginRev(): [number, () => void] {
  const [rev, setRev] = useState(0);
  useEffect(() => {
    attach();
    return pluginsChanged.on(() => setRev((n) => n + 1));
  }, []);
  return [rev, () => setRev((n) => n + 1)];
}

export const list = () => api<PluginList>(`${PATH_PLUGINS}?${client()}`);

export async function detail(id: string): Promise<Detail> {
  const [d, view] = await Promise.all([
    api<PluginDetail>(`${fill(PATH_PLUGIN, id)}?${client()}`),
    api<PluginAllowView>(PATH_PLUGIN_ALLOW_LIST).catch(() => null),
  ]);
  const m = d.manifest as PluginDetail["manifest"] & {
    permissions?: string[];
    contributes?: Record<string, unknown>;
    provides?: Record<string, unknown>;
  };
  const points = Object.keys(m.contributes ?? {}).filter((k) =>
    k.startsWith(SINGLE_PREFIX),
  );
  return {
    ...d,
    enabled: Boolean(view?.enabled.includes(id)),
    choices: view?.choices ?? {},
    risky: (m.permissions ?? []).filter(isRisky),
    singles: [...points, ...Object.keys(m.provides ?? {})],
  };
}

export const allow = (id: string, digest?: string) =>
  send(fill(PATH_PLUGIN_ALLOW, id), PUT, digest ? { digest } : {});
export const revoke = (id: string) => send(fill(PATH_PLUGIN_ALLOW, id), DELETE);
export const setEnabled = (id: string, on: boolean) =>
  send(fill(PATH_PLUGIN_ENABLED, id), on ? PUT : DELETE, on ? {} : undefined);
export const install = (id: string) =>
  api<PluginInstalled>(fill(PATH_PLUGIN_INSTALL, id), {
    method: POST,
    body: "{}",
    headers: { "content-type": "application/json" },
  });
export const update = (id: string) =>
  send(fill(PATH_PLUGIN_UPDATE, id), POST, {});
export const setAuto = (id: string, auto: boolean) =>
  send(fill(PATH_PLUGIN, id), "PATCH", { auto });
export const uninstall = (id: string) => send(fill(PATH_PLUGIN, id), DELETE);
export const choose = (point: string, plugin: string | null) =>
  send(fill(PATH_PLUGIN_CHOICE, point), PUT, { plugin });
export const devMode = () =>
  api<{ on: boolean; plugins?: unknown[] }>(PATH_PLUGIN_DEV_MODE);
export const setDevMode = (on: boolean) =>
  send(PATH_PLUGIN_DEV_MODE, PUT, { on });
export const devRemove = (id: string) =>
  send(fill(PATH_PLUGIN_DEV, id), DELETE);

/** 已装或已启用 (无 Agent 的插件没有安装记录, 靠 enabled 算) */
export const mine = (p: PluginItem) => Boolean(p.installed || p.enabled);
/** 管理员放行了比已装更新的版本 */
export const outdated = (p: PluginItem) =>
  Boolean(
    p.installed && p.allowed && p.installed.version !== p.allowed.version,
  );
/** 市场版本比放行的新, 管理员可以放行新版 */
export const pending = (p: PluginItem) =>
  !p.allowed || p.allowed.version !== p.version;
