import { TODO_PLUGIN, type PluginManifest } from "@hx-aioa/protocol";
import { AllowStore, type AllowRow } from "./allow-store";
import { SEED_BY, seedBuiltins } from "./builtins";
import { PluginKernel } from "./kernel";
import { PDataStore } from "./pdata";
import { PluginStore } from "./store";
import { OLD_TABLE, asTodoV2 } from "./todo-migrate";

const LEGACY_README = "README.md";
const LEGACY_PROMPT = "prompt.md";

/** 升级前已安装的插件: 用安装时存下的模板拼最小清单 (api 1), 放进白名单并为主人启用。 */
export function legacySeed(store: PluginStore, uid: string): { rows: AllowRow[]; uid: string } {
  const rows = store.legacy().map((s): AllowRow => {
    const i = s.install;
    const manifest: PluginManifest = {
      id: i.id,
      name: s.name,
      summary: "",
      version: i.version,
      readme: LEGACY_README,
      prompt: LEGACY_PROMPT,
      group: { title: s.name },
      agent: { name: s.name, ...(s.job?.interval ? { interval: s.job.interval } : {}), ...(s.job?.task ? { task: s.job.task } : {}) },
    };
    return { meta: { id: i.id, version: i.version, name: s.name, by: SEED_BY, at: i.installed }, manifest: asTodoV2(manifest), prompt: s.prompt };
  });
  return { rows, uid };
}

// 迁移前的旧表或迁移后的 pdata 里有待办; 只在一次性迁移时读
function hasTodos(sql: SqlStorage): boolean {
  const tables = new Set(sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").toArray().map((r) => r.name));
  if (tables.has(OLD_TABLE) && sql.exec(`SELECT 1 FROM ${OLD_TABLE} LIMIT 1`).toArray().length) return true;
  return tables.has("pdata") && sql.exec("SELECT 1 FROM pdata WHERE plugin = ? LIMIT 1", TODO_PLUGIN).toArray().length > 0;
}

/** Hub 装配插件相关的三件: 安装记录, 内核 (带升级迁移种子), 插件数据。 */
export function pluginParts(sql: SqlStorage, ownerId: () => string): { plugins: PluginStore; kernel: PluginKernel; pdata: PDataStore } {
  const plugins = new PluginStore(sql);
  const allow = new AllowStore(sql);
  const kernel = new PluginKernel(allow, () => legacySeed(plugins, ownerId()), () => seedBuiltins(allow, ownerId(), Date.now(), { has: (id) => !!plugins.get(id), remove: (id) => plugins.remove(id), hasTodos: () => hasTodos(sql) }));
  return { plugins, kernel, pdata: new PDataStore(sql) };
}

// Hub 建待办到点提醒用 (#105)
export { newRemind } from "./todo-notice";

// Hub 账号回调用: 管理员降级, 停用或删号时撤掉他的开发插件
export { retireDev } from "./api-dev";
