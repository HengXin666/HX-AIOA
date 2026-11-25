import { GH_LEGACY_ID, GH_PLUGIN_ID, GITHUB_PLUGIN, isRisky, parseManifest } from "@hx-aioa/protocol";
import ghManifest from "../../../plugins/hengxin666.gh/plugin.json";
import githubManifest from "../../../plugins/hengxin666.github/plugin.json";
import type { AllowRow, AllowStore } from "./allow-store";

const SEED_BY = "升级迁移";
const FLAG_PREFIX = "builtin:";

/** 旧安装记录: 只用来判断升级前装没装过 GitHub 授权 (base 插件 gh), 迁移后删掉。 */
export type LegacyInstalls = { has(id: string): boolean; remove(id: string): void };

/** 内置插件的清单随部署打包, 迁移时直接用, 不去市场拉。 */
export function builtinRow(raw: unknown, now: number): AllowRow {
  const m = parseManifest(raw);
  if (typeof m === "string") throw new Error(`内置插件清单有误: ${m}`);
  const risky = (m.permissions ?? []).filter(isRisky);
  return { meta: { id: m.id, version: m.version, name: m.name, by: SEED_BY, at: now, ...(risky.length ? { risky } : {}) }, manifest: m, prompt: "" };
}

// 每个内置插件只迁移一次; 之后管理员撤销或主人停用都不会被改回来
function once(store: AllowStore, id: string, want: boolean, raw: unknown, uid: string, now: number): boolean {
  const flag = FLAG_PREFIX + id;
  if (store.flag(flag)) return false;
  store.setFlag(flag);
  if (!want || store.allows().some((r) => r.meta.id === id)) return false;
  store.putAllow(builtinRow(raw, now));
  store.setEnabled(uid, id, true, now);
  return true;
}

/**
 * 升级迁移: 以前写死在服务端或以 base 插件装的, 现有部署行为不变。
 * - GitHub 接入 (hengxin666.github): 以前总是开着, 放行并为主人启用。
 * - GitHub 授权 (hengxin666.gh, 旧 id gh): 只有升级前装过才放行并启用, 删掉旧安装记录; 令牌与规则原样保留。
 */
export function seedBuiltins(store: AllowStore, uid: string, now = Date.now(), old?: LegacyInstalls): boolean {
  const github = once(store, GITHUB_PLUGIN, true, githubManifest, uid, now);
  const hadGh = !!old?.has(GH_LEGACY_ID);
  const gh = once(store, GH_PLUGIN_ID, hadGh, ghManifest, uid, now);
  if (hadGh) old?.remove(GH_LEGACY_ID);
  return github || gh;
}
