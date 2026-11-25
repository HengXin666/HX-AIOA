import type { PluginManifest } from "@hx-aioa/protocol";
import type { AllowRow } from "./allow-store";
import type { PluginStore } from "./store";

const LEGACY_README = "README.md";
const LEGACY_PROMPT = "prompt.md";
const SEED_BY = "升级迁移";

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
    return { meta: { id: i.id, version: i.version, name: s.name, by: SEED_BY, at: i.installed }, manifest, prompt: s.prompt };
  });
  return { rows, uid };
}
