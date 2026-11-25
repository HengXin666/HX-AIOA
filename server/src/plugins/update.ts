import { PLUGIN_SPACE_PREFIX, PLUGIN_VAR_CHANNEL, PLUGIN_VAR_TITLE, type PluginInstall, type PluginManifest } from "@hx-aioa/protocol";
import { CODE_BAD_REQUEST, CODE_NOT_FOUND } from "../constants";
import type { Core } from "../core";
import { ApiFail } from "../http";

/** 插件工作台: 按清单写入 (覆盖同 id), 返回工作台 id; 清单没有工作台就返回 undefined。 */
export async function applySpace(core: Core, id: string, m: PluginManifest, channel: string, title: string): Promise<string | undefined> {
  if (!m.space) return undefined;
  const raw = JSON.parse(JSON.stringify(m.space).replaceAll(PLUGIN_VAR_CHANNEL, channel).replaceAll(PLUGIN_VAR_TITLE, title));
  const r = await core.spaces.put({ ...raw, id: `${PLUGIN_SPACE_PREFIX}${id}` }, `plugin:${id}`);
  if ("errors" in r) throw new ApiFail(400, CODE_BAD_REQUEST, `插件布局有误: ${r.errors.join("; ")}`);
  core.sockets.toV1Clients({ t: "space_update", id: r.space.id, space: r.space });
  return r.space.id;
}

/**
 * 更新到市场最新版: 换提示词模板和工作台, 群, Agent, 密钥, 待办都不动。
 * 专属指令随之变版本号, Agent 下次拉取 (每天一次或遇到 401/403) 时自动换成新的。
 */
export async function upgrade(core: Core, id: string): Promise<PluginInstall> {
  const rec = core.plugins.get(id);
  if (!rec) throw new ApiFail(404, CODE_NOT_FOUND, `插件 ${id} 没有安装`);
  // 更新很少发生, 直接绕过缓存, 免得拿到新版本号配旧模板
  const m = await core.market.manifest(id, true);
  const prompt = await core.market.file(id, m.prompt, true);
  const title = core.chats.chat(rec.channel)?.title || m.group.title;
  const space = m.base ? undefined : await applySpace(core, id, m, rec.channel, title);
  if (rec.space && !space && (await core.spaces.remove(rec.space))) core.sockets.toV1Clients({ t: "space_update", id: rec.space, deleted: true });
  const { space: _old, ...rest } = rec;
  const { deps: _d, ...keep } = rest;
  const deps = (m.deps ?? []).map((d) => d.id);
  const next: PluginInstall = { ...keep, version: m.version, name: m.name, updated: Date.now(), ...(space ? { space } : {}), ...(deps.length ? { deps } : {}) };
  core.plugins.save(next, m.name, prompt, { interval: m.agent.interval, task: m.agent.task });
  return next;
}

export const autoOn = (r: PluginInstall): boolean => r.auto !== false;

/** 自动更新: 开着且版本不同才动; 市场连不上或新版有误时保持旧版, 不影响调用方。 */
export async function autoUpgrade(core: Core, id: string, latest?: string): Promise<void> {
  const rec = core.plugins.get(id);
  if (!rec || !autoOn(rec)) return;
  try {
    const v = latest ?? (await core.market.manifest(id)).version;
    if (v !== rec.version) await upgrade(core, id);
  } catch {
    // 下次再试; 市场有 5 分钟缓存, 不会频繁请求
  }
}
