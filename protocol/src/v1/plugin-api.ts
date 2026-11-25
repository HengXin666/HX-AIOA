import { API_V1 } from "./constants";

// 白名单 (全局, 管理员放行), 账号启用, 单选扩展点的账号选择, 插件数据 pdata
export const PATH_PLUGIN_ALLOW_LIST = `${API_V1}/plugin-allow`;
export const PATH_PLUGIN_ALLOW = `${API_V1}/plugin-allow/{id}`;
export const PATH_PLUGIN_ENABLED = `${API_V1}/plugins/{id}/enabled`;
export const PATH_PLUGIN_CHOICE = `${API_V1}/plugin-choice/{point}`;
export const PATH_PDATA_COLL = `${API_V1}/pdata/{plugin}/{coll}`;
export const PATH_PDATA_ITEM = `${API_V1}/pdata/{plugin}/{coll}/{id}`;

export const MAX_PDATA_BODY = 16_000;
export const MAX_PDATA_ROWS = 2_000;
export const MAX_PDATA_PAGE = 200;
// 批量写一次最多几行: Agent 一轮整理多条只用一次请求
export const MAX_PDATA_BATCH = 50;
export const PDATA_ID_RE = /^[\w.:-]{1,64}$/;

// 白名单里的一项: 每个插件只放一个版本; defaults 为它被指定为默认提供者的扩展点或服务
export type PluginAllow = { id: string; version: string; name: string; by: string; at: number; defaults?: string[]; risky?: string[] };
// PUT /plugin-allow/{id} 的请求体: 不写 version 就放行市场当前版本
export type PluginAllowInput = { version?: string; defaults?: string[] };
export type PluginAllowView = {
  allow: PluginAllow[];
  // 本账号启用了哪些, 单选扩展点选了谁
  enabled: string[];
  choices: Record<string, string>;
  budget: { total: number; limit: number };
  admin: boolean;
};

export const PLUGIN_CHANGES = ["allowed", "revoked", "enabled", "disabled", "updated"] as const;
export type PluginChange = (typeof PLUGIN_CHANGES)[number];
// 插件变化的推送: 客户端据此刷新插件相关界面; Agent 长连收到带 guide 的就立即重拉专属指令
export type PluginUpdateFrame = { t: "plugin_update"; id: string; change: PluginChange; version?: string; guide?: string };

// 插件数据: ver 每改一次加 1, 写入必须带读到的 ver (新建为 0); rev 是该账号该插件内递增的变更序号, 增量同步用
export type PDataItem = { id: string; ver: number; rev: number; updated: number; deleted?: true; body?: unknown };
// reset: since 早于回收掉的墓碑, 增量会漏删除, 这一页从头给; 客户端先清空本地副本再用
export type PDataList = { items: PDataItem[]; rev: number; more: boolean; reset?: true };
export type PDataPut = { ver: number; body: unknown };
// 批量写: 每行独立生效, deleted 为 true 时写墓碑; 结果按顺序给出新行, 冲突时的当前行或错误
export type PDataBatch = { items: { id: string; ver: number; body?: unknown; deleted?: true }[] };
export type PDataBatchResult = { items: { id: string; item?: PDataItem; conflict?: PDataItem | null; error?: string }[]; rev: number };
// 插件数据有变: 只推给该账号的界面连接, 客户端按 rev 增量拉
export type PDataSyncFrame = { t: "pdata_sync"; plugin: string; coll: string; rev: number };
