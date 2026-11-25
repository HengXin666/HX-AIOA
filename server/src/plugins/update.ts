import { PLUGIN_SPACE_PREFIX, PLUGIN_VAR_CHANNEL, PLUGIN_VAR_TITLE, type PluginInstall, type PluginManifest } from "@hx-aioa/protocol";
import { CODE_BAD_REQUEST, CODE_NOT_FOUND } from "../constants";
import type { Core } from "../core";
import { ApiFail } from "../http";
import { pushPlugin } from "./notify";

export const CODE_NOT_ALLOWED = "plugin_not_allowed";

/** 插件工作台: 按清单写入 (覆盖同 id), 返回工作台 id; 清单没有工作台就返回 undefined。 */
export async function applySpace(core: Core, id: string, m: PluginManifest, channel: string, title: string): Promise<string | undefined> {
  if (!m.space) return undefined;
  const raw = JSON.parse(JSON.stringify(m.space).replaceAll(PLUGIN_VAR_CHANNEL, channel).replaceAll(PLUGIN_VAR_TITLE, title));
  const r = await core.spaces.put({ ...raw, id: `${PLUGIN_SPACE_PREFIX}${id}` }, `plugin:${id}`);
  if ("errors" in r) throw new ApiFail(400, CODE_BAD_REQUEST, `插件布局有误: ${r.errors.join("; ")}`);
  core.sockets.toV1Clients({ t: "space_update", id: r.space.id, space: r.space });
  return r.space.id;
}

/** 白名单里的快照; 没放行就报错。 */
export function allowed(core: Core, id: string) {
  const row = core.kernel.get(id);
  if (!row) throw new ApiFail(403, CODE_NOT_ALLOWED, `插件 ${id} 还没被管理员放行`);
  return row;
}

/**
 * 更新到白名单里的版本: 换提示词模板和工作台, 群, Agent, 密钥, 数据都不动;
 * 再推 plugin_update 给界面与该插件 Agent 的长连, Agent 立即重拉专属指令。
 */
export async function upgrade(core: Core, id: string): Promise<PluginInstall> {
  const rec = core.plugins.get(id);
  if (!rec) throw new ApiFail(404, CODE_NOT_FOUND, `插件 ${id} 没有安装`);
  const { manifest: m, prompt } = allowed(core, id);
  const title = core.chats.chat(rec.channel)?.title || m.group.title;
  const space = await applySpace(core, id, m, rec.channel, title);
  if (rec.space && !space && (await core.spaces.remove(rec.space))) core.sockets.toV1Clients({ t: "space_update", id: rec.space, deleted: true });
  const { space: _old, ...rest } = rec;
  const next: PluginInstall = { ...rest, version: m.version, name: m.name, updated: Date.now(), ...(space ? { space } : {}) };
  core.plugins.save(next, m.name, prompt, { interval: m.agent.interval, task: m.agent.task });
  pushPlugin(core, id, "updated", { uid: core.users.ownerId(), version: m.version, keyId: next.keyId });
  return next;
}

export const autoOn = (r: PluginInstall): boolean => r.auto !== false;

/** 自动更新: 开着且白名单版本与已装不同才动; 出错保持旧版, 不影响调用方。 */
export async function autoUpgrade(core: Core, id: string): Promise<void> {
  const rec = core.plugins.get(id);
  const v = core.kernel.get(id)?.meta.version;
  if (!rec || !autoOn(rec) || !v || v === rec.version) return;
  try {
    await upgrade(core, id);
  } catch (e) {
    console.error(`插件 ${id} 自动更新失败:`, e);
  }
}
