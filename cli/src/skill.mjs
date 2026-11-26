// skill: 按简报里的来源从 Git 下载到临时目录, 全部成功后原子替换; 每个命令结束前按 X-Aioa-Want 小更新自动重装
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { formatBrief, getNext } from "./brief.mjs";
import { saveConfig } from "./config.mjs";
import { ApiError, fetchText, seenWant } from "./http.mjs";
import { CORE_SKILL, SKILL_GIT_BASE, missingMajors, parseSkillHeader, parseSkillVer, skillGap } from "./proto.mjs";
import { selfUpdate } from "./update.mjs";

const MANIFEST = "manifest.json";
const SKILL_MD = "SKILL.md";
// 插件 skill 装进核心 skill 的处理步骤里, 一个插件一个 <id>.md
const IMPL_DIR = join("steps", "2-handle", "impl");
const PLUGIN_ENTRY = "handle.md";
const SAFE_FILE = /^(?!.*\.\.)[\w.-]+(\/[\w.-]+)*$/;
export const MAJOR_AUTO = "大更新: 运行 hxaioa upgrade";

function defaultDir() {
  const claude = join(homedir(), ".claude", "skills");
  return existsSync(claude) ? claude : join(homedir(), ".agents", "skills");
}

// HXAIOA_GIT_BASE 换掉默认的 raw 前缀 (镜像)
function rawBase(url) {
  const mirror = process.env.HXAIOA_GIT_BASE;
  const u = mirror && url.startsWith(SKILL_GIT_BASE) ? mirror.replace(/\/+$/, "") + url.slice(SKILL_GIT_BASE.length) : url;
  return u.replace(/\/+$/, "");
}

/** 下载一个 skill 目录的 manifest 列的全部文件; place 把清单里的路径映射到临时目录下的路径。返回清单里的版本。 */
async function fetchSkill(src, tmp, place) {
  const base = rawBase(src.url);
  let manifest;
  try {
    manifest = JSON.parse(await fetchText(`${base}/${MANIFEST}`));
  } catch (e) {
    throw new ApiError(0, `${src.id} 的 ${MANIFEST} 读不了: ${e.message}`);
  }
  const files = manifest.files;
  if (!Array.isArray(files) || !files.length || !parseSkillVer(manifest.version)) throw new ApiError(0, `${src.id} 的 ${MANIFEST} 不对`);
  if (manifest.version !== src.version) process.stderr.write(`${src.id}: Git 上是 ${manifest.version}, 服务端说 ${src.version}, 按 Git 装\n`);
  for (const f of files) {
    if (typeof f !== "string" || !SAFE_FILE.test(f)) throw new ApiError(0, `${src.id} 的清单里有不安全的路径: ${f}`);
    const text = await fetchText(`${base}/${f}`);
    const to = join(tmp, place(f));
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, text);
  }
  return { version: manifest.version, manifest };
}

// 旧目录先挪开再换上新的, 换失败就挪回去
function swap(tmp, target) {
  const old = join(dirname(target), `.${CORE_SKILL}.old-${process.pid}`);
  const had = existsSync(target);
  if (had) renameSync(target, old);
  try {
    renameSync(tmp, target);
  } catch (e) {
    if (had) renameSync(old, target);
    throw e;
  }
  if (had) rmSync(old, { recursive: true, force: true });
}

/**
 * 装 (或重装) 核心 skill 与本群插件的 skill。setup 不给时沿用已装的, 第一次装用服务端应有的。
 * brief 不给时先 GET next?brief= 拿全文。返回写进配置的 { setup, skills, dir }。
 */
export async function install(cfg, { setup, dir } = {}, brief) {
  brief = brief ?? (await getNext(cfg, { force: true })).brief;
  const srcs = brief?.skills ?? [];
  const core = srcs.find((s) => s.id === CORE_SKILL);
  if (!core) throw new ApiError(0, "服务端没有给出 skill 来源, 这个群可能还不支持 skill");
  const root = dir ? resolve(dir) : cfg.skill?.dir || defaultDir();
  mkdirSync(root, { recursive: true });
  const tmp = join(root, `.${CORE_SKILL}.tmp-${process.pid}`);
  rmSync(tmp, { recursive: true, force: true });
  const skills = {};
  try {
    const got = await fetchSkill(core, tmp, (f) => f);
    writeFileSync(join(tmp, MANIFEST), JSON.stringify(got.manifest, null, 2));
    skills[core.id] = got.version;
    for (const s of srcs) {
      if (s.id === CORE_SKILL) continue;
      const place = (f) => (f === PLUGIN_ENTRY ? join(IMPL_DIR, `${s.id}.md`) : join(IMPL_DIR, s.id, f));
      skills[s.id] = (await fetchSkill(s, tmp, place)).version;
    }
    swap(tmp, join(root, CORE_SKILL));
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
  const n = Number.parseInt(setup, 10);
  const rec = { setup: Number.isInteger(n) ? n : (cfg.skill?.setup ?? brief.want?.setup ?? 0), skills, dir: root };
  saveConfig({ skill: rec });
  cfg.skill = rec;
  return rec;
}

const listOf = (skills) => Object.entries(skills).map(([id, v]) => `${id}@${v}`).join(", ");

export function installedText(rec) {
  return `skill 已装到 ${join(rec.dir, CORE_SKILL)}: ${listOf(rec.skills)} (接入版本 ${rec.setup})`;
}

let settled = false;

/**
 * 命令结束前看最近的 X-Aioa-Want: 小更新自动重装 skill 并同大版本自更新命令行, 大更新只给固定一行。
 * 返回要打印的行; 一个进程只处理一次。没装 skill 的老 Agent 不管。
 */
export async function settleWant(cfg) {
  if (settled) return [];
  settled = true;
  const want = parseSkillHeader(seenWant());
  const have = cfg.skill;
  if (!want || !have?.skills) return [];
  const gap = skillGap(have, want);
  if (gap === "major") return [want.auto ? MAJOR_AUTO : `大更新, 需要重新接入 (${missingMajors(have, want).join(", ")}): 不要自己安装, 在群里告诉主人`];
  if (gap !== "minor") return [];
  const out = [];
  try {
    const rec = await install(cfg, { setup: have.setup, dir: have.dir });
    out.push(`skill 已自动更新到 ${listOf(rec.skills)}, 下一轮生效`);
  } catch (e) {
    return [`skill 自动更新失败 (${e.message}), 下个命令会再试, 本轮照旧`];
  }
  try {
    const v = await selfUpdate();
    if (v) out.push(`hxaioa 已自动更新到 ${v}, 下一条命令生效`);
  } catch (e) {
    process.stderr.write(`hxaioa 自更新失败: ${e.message}\n`);
  }
  return out;
}

/** 大更新自动执行: 只在服务端说主人开了开关 (want.auto) 时做, 否则和大更新提示一样停下。 */
export async function upgrade(cfg, v) {
  settled = true;
  const brief = (await getNext(cfg, { force: true })).brief;
  const want = brief?.want ?? parseSkillHeader(seenWant());
  if (!want?.auto) throw new ApiError(0, "大更新自动执行没有打开: 不要自己安装, 在群里告诉主人");
  const out = [];
  try {
    const nv = await selfUpdate(undefined, { sameMajor: false });
    out.push(nv ? `hxaioa 已更新到 ${nv}` : "hxaioa 已是最新");
  } catch (e) {
    out.push(`hxaioa 更新失败: ${e.message}`);
  }
  out.push(installedText(await install(cfg, { setup: want.setup, dir: v.dir }, brief)));
  out.push("触发语或定时间隔如果也变了, 这些要主人改, 在群里告诉主人");
  return out;
}

/** 给不支持 skill 的宿主: SKILL.md 全文 + 当前简报。 */
export async function skillGuide(cfg) {
  const file = join(cfg.skill.dir, CORE_SKILL, SKILL_MD);
  if (!existsSync(file)) throw new ApiError(0, `${file} 不在了, 先运行 hxaioa skill install`);
  const r = await getNext(cfg);
  return [readFileSync(file, "utf8").trimEnd(), "", r.current ? formatBrief(r.current) : "(暂时拿不到简报)"];
}
