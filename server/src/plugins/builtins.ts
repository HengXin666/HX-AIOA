import { GITHUB_PLUGIN, isRisky, parseManifest } from "@hx-aioa/protocol";
import githubManifest from "../../../plugins/hengxin666.github/plugin.json";
import type { AllowRow, AllowStore } from "./allow-store";

const SEED_BY = "升级迁移";
const FLAG_PREFIX = "builtin:";

/** 内置插件的清单随部署打包, 迁移时直接用, 不去市场拉。 */
export function builtinRow(raw: unknown, now: number): AllowRow {
  const m = parseManifest(raw);
  if (typeof m === "string") throw new Error(`内置插件清单有误: ${m}`);
  const risky = (m.permissions ?? []).filter(isRisky);
  return { meta: { id: m.id, version: m.version, name: m.name, by: SEED_BY, at: now, ...(risky.length ? { risky } : {}) }, manifest: m, prompt: "" };
}

/**
 * 升级迁移: GitHub 接入以前写死在服务端, 现有部署视为已放行并为主人启用, 行为不变。
 * 每个内置插件只跑一次; 之后管理员撤销或主人停用都不会被改回来。
 */
export function seedBuiltins(store: AllowStore, uid: string, now = Date.now()): boolean {
  const flag = FLAG_PREFIX + GITHUB_PLUGIN;
  if (store.flag(flag)) return false;
  store.setFlag(flag);
  if (store.allows().some((r) => r.meta.id === GITHUB_PLUGIN)) return false;
  store.putAllow(builtinRow(githubManifest, now));
  store.setEnabled(uid, GITHUB_PLUGIN, true, now);
  return true;
}
