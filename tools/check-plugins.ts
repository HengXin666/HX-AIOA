// 市场 CI: 校验 plugins/ 下每个清单, 按 "全部放进白名单" 做静态冲突检测与每日请求估算, 输出兼容报告
// 用法: node --import tsx tools/check-plugins.ts [市场目录]; 环境变量 PR_AUTHOR + CHANGED (改动的插件目录, 逗号分隔) 时校验命名空间,
// BASE (git 引用, 如 origin/main) 时检查改了的插件有没有升版本
import { existsSync, readdirSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { checkBumps, checkClosures, checkCycles, checkIndex, depTable, type IndexEntry } from "./plugin-index";
import { PLUGIN_DAILY_BUDGET, PROTOCOL_VERSION, checkPlugins, dailyRequests, isL2a, parseManifest, pluginNamespace, type PluginManifest } from "@hx-aioa/protocol";

const root = process.argv[2] ?? "plugins";
// 维护者可以动任何命名空间 (含旧 id 的插件)
const MAINTAINERS = (process.env.MAINTAINERS ?? "hengxin666").toLowerCase().split(",");
const author = (process.env.PR_AUTHOR ?? "").toLowerCase();
const changed = new Set((process.env.CHANGED ?? "").split(",").filter(Boolean));
const errors: string[] = [];
const warns: string[] = [];

const index = JSON.parse(readFileSync(join(root, "index.json"), "utf8")) as { plugins: IndexEntry[] };
const listed = new Map(index.plugins.map((p) => [p.id, p.version]));
const ms: PluginManifest[] = [];
const raws = new Map<string, unknown>();
for (const dir of readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory())) {
  const file = join(root, dir.name, "plugin.json");
  if (!existsSync(file)) continue;
  const json = JSON.parse(readFileSync(file, "utf8")) as unknown;
  const m = parseManifest(json);
  if (typeof m === "string") {
    errors.push(`${dir.name}: ${m}`);
    continue;
  }
  if (m.id !== dir.name) errors.push(`${dir.name}: 目录名与 id ${m.id} 不一致`);
  if (listed.get(m.id) !== m.version) errors.push(`${m.id}: index.json 里的版本 ${listed.get(m.id) ?? "缺失"} 与清单 ${m.version} 不一致`);
  for (const f of [m.readme, m.prompt]) if (!existsSync(join(root, dir.name, f))) errors.push(`${m.id}: 缺少文件 ${f}`);
  if (author && changed.has(dir.name) && !MAINTAINERS.includes(author)) {
    const ns = pluginNamespace(m.id);
    if (ns !== author) errors.push(`${m.id}: 命名空间必须是 PR 作者的 GitHub 登录名 ${author}`);
  }
  // 带服务端代码的插件必须编进部署 (L2A_PLUGINS), 反过来编进去的也必须声明
  if ((m.server === true) !== isL2a(m.id)) errors.push(`${m.id}: "server": true 与服务端 L2A_PLUGINS 不一致`);
  raws.set(m.id, json);
  ms.push(m);
}

const engine = `${PROTOCOL_VERSION}.0.0`;
checkIndex(index.plugins, ms, errors, warns, raws);
checkCycles(ms, errors);
checkClosures(ms, engine, errors, warns);
if (process.env.BASE) checkBumps(process.env.BASE, ms, root, errors);
const r = checkPlugins(ms, { engine, budget: PLUGIN_DAILY_BUDGET });
for (const c of r.conflicts) {
  // 单选冲突由管理员放行时指定默认, 市场里只提示
  (c.kind === "single" ? warns : errors).push(`[${c.kind}] ${c.plugins.join(", ")}: ${c.detail}`);
}

const lines = [
  "## 插件兼容报告",
  "",
  "| 插件 | 版本 | 每天估算请求 |",
  "| --- | --- | --- |",
  ...ms.map((m) => `| ${m.id} | ${m.version} | ${dailyRequests(m)} |`),
  "",
  `合计每天约 ${r.total} 次, 上限 ${PLUGIN_DAILY_BUDGET}。`,
  "",
  ...depTable(ms),
  ...(errors.length ? ["### 错误", ...errors.map((e) => `- ${e}`), ""] : []),
  ...(warns.length ? ["### 提示 (放行时由管理员裁决)", ...warns.map((w) => `- ${w}`), ""] : []),
];
const report = lines.join("\n");
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
process.exit(errors.length ? 1 : 0);
