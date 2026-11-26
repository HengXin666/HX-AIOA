// 市场索引与依赖的检查, 给 tools/check-plugins.ts 用: 索引整洁, 版本号递增, 依赖闭包能单独装, 依赖不成环
import { execFileSync } from "node:child_process";
import { checkPlugins, cmpVer, parseVer, satisfies, type PluginManifest } from "@hx-aioa/protocol";

export type IndexEntry = { id: string; version: string; name?: string; summary?: string; icon?: string; author?: string; manifest?: unknown };
const INDEX_FIELDS = ["name", "summary", "icon", "author"] as const;

/** index.json 自身: 不重复, 必填字段齐, 每条都有目录, 名字和清单一致。 */
export function checkIndex(entries: IndexEntry[], ms: PluginManifest[], errors: string[], warns: string[], raw: Map<string, unknown> = new Map()): void {
  const seen = new Set<string>();
  const byId = new Map(ms.map((m) => [m.id, m]));
  for (const e of entries) {
    if (seen.has(e.id)) errors.push(`index.json: ${e.id} 出现了两次`);
    seen.add(e.id);
    const m = byId.get(e.id);
    if (!m) {
      errors.push(`index.json: ${e.id} 没有对应的插件目录`);
      continue;
    }
    for (const f of INDEX_FIELDS) if (!e[f]) errors.push(`index.json: ${e.id} 缺少 ${f}`);
    // 内嵌的清单必须和目录里的一字不差, 不然服务端列表与详情会用到旧内容
    if (e.manifest !== undefined && JSON.stringify(e.manifest) !== JSON.stringify(raw.get(e.id))) errors.push(`index.json: ${e.id} 内嵌的清单与 plugin.json 不一致, 跑 npm run build:index`);
    if (e.name && e.name !== m.name) warns.push(`index.json: ${e.id} 的名字 "${e.name}" 与清单 "${m.name}" 不一致`);
  }
}

/** 基线 (PR 的目标分支, 或 push 前的提交) 里的清单; 没有基线或文件新建时返回 null。 */
function baseManifest(base: string, dir: string, root: string): { version: string } | null {
  try {
    // 在市场目录里跑 git, 市场目录可以是别的仓库 (索引仓库的 CI 从 HX-AIOA 调这个脚本)
    return JSON.parse(execFileSync("git", ["show", `${base}:./${dir}/plugin.json`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })) as { version: string };
  } catch {
    return null;
  }
}

function changedSince(base: string, dir: string, root: string): boolean {
  try {
    execFileSync("git", ["diff", "--quiet", base, "--", dir], { cwd: root, stdio: "ignore" });
    return false;
  } catch {
    return true;
  }
}

/** 插件目录有改动就必须升版本, 否则已装的部署不会更新; 版本也不能倒退。 */
export function checkBumps(base: string, ms: PluginManifest[], root: string, errors: string[]): void {
  for (const m of ms) {
    if (!changedSince(base, m.id, root)) continue;
    const old = baseManifest(base, m.id, root);
    if (!old) continue;
    const a = parseVer(old.version);
    const b = parseVer(m.version);
    if (!a || !b) continue;
    const d = cmpVer(b, a);
    if (d < 0) errors.push(`${m.id}: 版本从 ${old.version} 倒退到 ${m.version}`);
    else if (d === 0 && m.version === old.version) errors.push(`${m.id}: 目录有改动但版本仍是 ${m.version}, 升一下版本 (plugin.json 与 index.json 一起改)`);
  }
}

type Dep = { from: string; to: string; range: string; optional: boolean };

/** 谁依赖谁: requires / optional 的服务由市场里哪个插件提供。 */
export function deps(ms: PluginManifest[]): Dep[] {
  const out: Dep[] = [];
  for (const m of ms) {
    for (const [optional, map] of [[false, m.requires], [true, m.optional]] as const) {
      for (const [s, range] of Object.entries(map ?? {})) {
        for (const p of ms) if (p.id !== m.id && p.provides?.[s] !== undefined) out.push({ from: m.id, to: p.id, range: `${s}@${range}`, optional });
      }
    }
  }
  return out;
}

/** 依赖成环 (只看 requires): 装哪个都要先装另一个。 */
export function checkCycles(ms: PluginManifest[], errors: string[]): void {
  const hard = deps(ms).filter((d) => !d.optional);
  const next = new Map<string, string[]>();
  for (const d of hard) next.set(d.from, [...(next.get(d.from) ?? []), d.to]);
  const state = new Map<string, 1 | 2>();
  const visit = (id: string, path: string[]): void => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) {
      errors.push(`依赖成环: ${[...path.slice(path.indexOf(id)), id].join(" -> ")}`);
      return;
    }
    state.set(id, 1);
    for (const t of next.get(id) ?? []) visit(t, [...path, id]);
    state.set(id, 2);
  };
  for (const m of ms) visit(m.id, []);
}

/** 每个插件只带上它 requires 的提供者 (取满足范围的最高版本) 能不能单独装上。 */
export function checkClosures(ms: PluginManifest[], engine: string, errors: string[], warns: string[]): void {
  for (const m of ms) {
    const pick = new Map<string, PluginManifest>([[m.id, m]]);
    const queue = [m];
    while (queue.length) {
      const cur = queue.pop()!;
      for (const [s, range] of Object.entries(cur.requires ?? {})) {
        const best = ms.filter((p) => p.id !== cur.id && p.provides?.[s] !== undefined && satisfies(p.provides[s]!, range)).sort((a, b) => cmpVer(parseVer(b.version) ?? [0, 0, 0], parseVer(a.version) ?? [0, 0, 0]))[0];
        if (best && !pick.has(best.id)) {
          pick.set(best.id, best);
          queue.push(best);
        }
      }
    }
    const r = checkPlugins([...pick.values()], { engine });
    for (const c of r.conflicts) if (c.kind !== "single" && c.kind !== "budget") errors.push(`单独装 ${m.id} (连同 ${[...pick.keys()].filter((k) => k !== m.id).join(", ") || "无依赖"}) 时: [${c.kind}] ${c.detail}`);
    for (const [s, range] of Object.entries(m.optional ?? {})) {
      const providers = ms.filter((p) => p.provides?.[s] !== undefined);
      if (providers.length && !providers.some((p) => satisfies(p.provides[s]!, range))) warns.push(`${m.id}: 可选依赖 ${s}@${range} 的提供者 ${providers.map((p) => `${p.id}(${p.provides[s]})`).join(", ")} 版本不满足, 装了也不会用上`);
    }
  }
}

/** 报告里的依赖表。 */
export function depTable(ms: PluginManifest[]): string[] {
  const list = deps(ms);
  if (!list.length) return [];
  return ["### 依赖", "", "| 插件 | 依赖 | 提供者 | 类型 |", "| --- | --- | --- | --- |", ...list.map((d) => `| ${d.from} | ${d.range} | ${d.to} | ${d.optional ? "可选" : "必需"} |`), ""];
}
