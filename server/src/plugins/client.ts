import { QUERY_CLIENT, QUERY_CLIENT_BUILD, clientLevel, narrowSpace, parseClient, type ClientFit, type ClientRef, type PluginManifest, type Space } from "@hx-aioa/protocol";
import type { Core } from "../core";
import type { Attachment } from "../sockets";

// 按端兼容 (#156): 请求或连接是哪个端, 插件在这个端上的级别, 工作台按端裁剪; 不支持的端不给界面, 数据照常
const ANDROID: ClientRef = { kind: "android" };
const PLUGIN_ORIGIN = "plugin:";

/** 请求地址上带的端与构建号; 没带 (老客户端都是安卓) 当安卓, 构建号未知。 */
export const clientOfUrl = (url: URL): ClientRef => parseClient(url.searchParams.get(QUERY_CLIENT), url.searchParams.get(QUERY_CLIENT_BUILD)) ?? ANDROID;
/** 长连接上记下的端与构建号, 规则同 clientOfUrl。 */
export const clientOfAtt = (a: Attachment): ClientRef => (a.client ? { kind: a.client, ...(a.cb ? { build: a.cb } : {}) } : ANDROID);

/** 握手时记到连接上的字段; 没带 client 的不记。 */
export function attClient(url: URL): Pick<Attachment, "client" | "cb"> {
  const ref = parseClient(url.searchParams.get(QUERY_CLIENT), url.searchParams.get(QUERY_CLIENT_BUILD));
  return ref ? { client: ref.kind, ...(ref.build ? { cb: ref.build } : {}) } : {};
}

export const fitOf = (m: Pick<PluginManifest, "clients" | "engines">, ref: ClientRef): ClientFit => clientLevel(m, ref.kind, ref.build);

/** 工作台对这个端的样子: 插件工作台在不支持的端上不给, 写了组件级 clients 的按端裁剪。 */
export function spaceFor<T extends Space>(core: Core, space: T, ref: ClientRef): T | null {
  const id = space.origin?.startsWith(PLUGIN_ORIGIN) ? space.origin.slice(PLUGIN_ORIGIN.length) : undefined;
  const m = id ? core.kernel.get(id)?.manifest : undefined;
  if (m && fitOf(m, ref).level === "unsupported") return null;
  return narrowSpace(space, ref.kind);
}

/** 推一个工作台的变化给主人的界面连接, 每个端各给各的。 */
export function pushSpace(core: Core, space: Space): void {
  core.sockets.toV1ClientsBy((a) => {
    const s = spaceFor(core, space, clientOfAtt(a));
    return s ? { t: "space_update", id: space.id, space: s } : null;
  });
}
