// skill 门禁, 给 tools/check-plugins.ts 用: manifest 与目录一致, 版本与协议和插件清单一致, 改了内容必须升版本 (docs/design/agent-skill.md)
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { CORE_SKILL, CORE_SKILL_VERSION, parseSkillVer, type PluginManifest } from "@hx-aioa/protocol";

const MANIFEST = "manifest.json";
const SKILL_DIR = "skill";
const CORE_DIR = join("skills", CORE_SKILL);
const PROMPT_FILE = join("server", "src", "agent-prompt.ts");
// 旧专属指令 (给没装 skill 的 Agent), 改它不影响接入语与触发语
const LEGACY_FNS = ["agentGuide", "feedSection"];

type SkillManifest = { name?: unknown; version?: unknown; files?: unknown };

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (e.isFile()) out.push(relative(dir, join(e.parentPath, e.name)).split("\\").join("/"));
  }
  return out.filter((f) => f !== MANIFEST).sort();
}

/** 一个 skill 目录: manifest 的名字, 版本对得上, files 与目录里的文件一一对应。 */
function checkSkillDir(dir: string, name: string, version: string, label: string, errors: string[]): void {
  const file = join(dir, MANIFEST);
  if (!existsSync(file)) {
    errors.push(`${label}: 缺少 ${MANIFEST}`);
    return;
  }
  let m: SkillManifest;
  try {
    m = JSON.parse(readFileSync(file, "utf8")) as SkillManifest;
  } catch {
    errors.push(`${label}: ${MANIFEST} 不是合法 JSON`);
    return;
  }
  if (m.name !== name) errors.push(`${label}: ${MANIFEST} 的 name 应为 ${name}`);
  if (typeof m.version !== "string" || !parseSkillVer(m.version)) errors.push(`${label}: ${MANIFEST} 的 version 必须是 "大.小"`);
  else if (m.version !== version) errors.push(`${label}: ${MANIFEST} 的 version ${m.version} 与 ${version} 不一致`);
  if (!Array.isArray(m.files) || !m.files.every((f) => typeof f === "string")) {
    errors.push(`${label}: ${MANIFEST} 的 files 必须是文件路径数组`);
    return;
  }
  const listed = new Set(m.files as string[]);
  const actual = new Set(listFiles(dir));
  for (const f of listed) if (!actual.has(f)) errors.push(`${label}: ${MANIFEST} 列了 ${f}, 但文件不存在`);
  for (const f of actual) if (!listed.has(f)) errors.push(`${label}: 目录里多了 ${f}, 没有列进 ${MANIFEST}`);
}

/** 静态检查: 核心 skill 版本 = CORE_SKILL_VERSION; 有 agent.skill 的插件必须带同版本的 skill 目录。 */
export function checkSkills(repo: string, root: string, ms: PluginManifest[], errors: string[]): void {
  // 市场目录可以是别的仓库 (索引仓库的 CI), 那里没有核心 skill
  const core = join(repo, CORE_DIR);
  if (existsSync(core)) checkSkillDir(core, CORE_SKILL, CORE_SKILL_VERSION, CORE_DIR, errors);
  else if (existsSync(join(repo, PROMPT_FILE))) errors.push(`缺少核心 skill 目录 ${CORE_DIR}`);
  for (const m of ms) {
    const dir = join(root, m.id, SKILL_DIR);
    const ver = m.agent?.skill;
    if (ver === undefined) {
      if (existsSync(dir)) errors.push(`${m.id}: 有 ${SKILL_DIR}/ 目录但 plugin.json 没写 agent.skill`);
      continue;
    }
    if (!parseSkillVer(ver)) errors.push(`${m.id}: agent.skill 必须是 "大.小", 现在是 ${ver}`);
    if (!existsSync(dir)) errors.push(`${m.id}: 写了 agent.skill 但缺少 ${SKILL_DIR}/ 目录`);
    else checkSkillDir(dir, m.id, ver, `${m.id}/${SKILL_DIR}`, errors);
  }
}

function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

const changed = (cwd: string, base: string, path: string): boolean => git(cwd, ["diff", "--quiet", base, "--", path]) === null;
const showAt = (cwd: string, base: string, path: string): string | null => git(cwd, ["show", `${base}:./${path.split("\\").join("/")}`]);

function versionAt(cwd: string, base: string, path: string, pick: (j: Record<string, unknown>) => unknown): string | null {
  const text = showAt(cwd, base, path);
  if (text === null) return null;
  try {
    const v = pick(JSON.parse(text) as Record<string, unknown>);
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

/** 接入语与触发语模板: 去掉旧专属指令的函数, 注释和空行后剩下的文本。 */
export function promptTemplates(src: string): string {
  const lines = src.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const head = /^(?:export\s+)?function\s+(\w+)/.exec(lines[i]!);
    if (head && LEGACY_FNS.includes(head[1]!)) {
      while (i < lines.length && lines[i] !== "}") i++;
      continue;
    }
    const t = lines[i]!.trim();
    if (t && !t.startsWith("//")) out.push(t);
  }
  return out.join("\n");
}

function bumpError(label: string, from: string, to: string, needMajor: boolean): string | null {
  const a = parseSkillVer(from);
  const b = parseSkillVer(to);
  if (!a || !b) return null;
  if (b.major < a.major || (b.major === a.major && b.minor < a.minor)) return `${label}: 版本从 ${from} 倒退到 ${to}`;
  if (needMajor && b.major === a.major) return `${label}: 必须升大号 (现在 ${from} -> ${to})`;
  if (from === to) return `${label}: 内容改了但版本仍是 ${to}, 升一下版本`;
  return null;
}

/** 设了 BASE: skill 文件改了要升版本, 接入语或触发语模板改了要升核心大号。基线里还没有的不查。 */
export function checkSkillBumps(base: string, repo: string, root: string, ms: PluginManifest[], errors: string[]): void {
  for (const m of ms) {
    const ver = m.agent?.skill;
    const dir = join(relative(repo, root), m.id, SKILL_DIR);
    if (ver === undefined || !changed(repo, base, dir)) continue;
    const old = versionAt(repo, base, join(relative(repo, root), m.id, "plugin.json"), (j) => (j.agent as Record<string, unknown> | undefined)?.skill);
    if (old === null) continue;
    const e = bumpError(`${m.id}: ${SKILL_DIR}/ 改了, agent.skill`, old, ver, false);
    if (e) errors.push(e);
  }
  const coreFile = join(CORE_DIR, MANIFEST);
  const oldCore = versionAt(repo, base, coreFile, (j) => j.version);
  if (oldCore === null || !existsSync(join(repo, coreFile))) return;
  const now = (JSON.parse(readFileSync(join(repo, coreFile), "utf8")) as SkillManifest).version;
  if (typeof now !== "string") return;
  if (changed(repo, base, CORE_DIR)) {
    const e = bumpError(`${CORE_DIR} 改了, ${MANIFEST} 的 version`, oldCore, now, false);
    if (e) errors.push(e);
  }
  const before = showAt(repo, base, PROMPT_FILE);
  const promptPath = join(repo, PROMPT_FILE);
  if (before === null || !existsSync(promptPath)) return;
  if (promptTemplates(before) !== promptTemplates(readFileSync(promptPath, "utf8"))) {
    const e = bumpError(`${PROMPT_FILE} 的接入语或触发语模板改了, 核心 skill`, oldCore, now, true);
    if (e) errors.push(e);
  }
}
