// 配置与进度: ~/.hxaioa/config.json (服务地址 + 密钥, 权限 600) 与 state.json (每个群读到的位置, next 的本轮窗口)
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DIR = process.env.HXAIOA_HOME || join(homedir(), ".hxaioa");
const CONFIG = join(DIR, "config.json");
const STATE = join(DIR, "state.json");
const BRIEF = join(DIR, "brief.json");
const PRIVATE = 0o600;

function readJson(path) {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

function writeJson(path, value) {
  mkdirSync(DIR, { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(value, null, 2), { mode: PRIVATE });
  chmodSync(path, PRIVATE);
}

/** 环境变量优先 (AIOA_SERVER / AIOA_KEY / AIOA_CHANNEL), 其次配置文件。skill 为已装的 { setup, skills, dir }。 */
export function loadConfig() {
  const f = readJson(CONFIG);
  const server = (process.env.AIOA_SERVER || f.server || "").replace(/\/+$/, "");
  const key = process.env.AIOA_KEY || f.key || "";
  return { server, key, channel: process.env.AIOA_CHANNEL || f.channel || "", me: f.me, guide: f.guide, skill: f.skill };
}

export function saveConfig(cfg) {
  writeJson(CONFIG, { ...readJson(CONFIG), ...cfg });
}

export const configPath = CONFIG;
export const dataDir = DIR;

export function loadState() {
  const s = readJson(STATE);
  return { heads: s.heads ?? {}, last: s.last ?? 0, until: s.until ?? 0, round: s.round ?? null };
}

/** watch --window 的截止时间 (ms): 跨多次调用累计等待, 0 清掉。 */
export function saveUntil(until) {
  const s = { ...readJson(STATE) };
  if (until) s.until = until;
  else delete s.until;
  writeJson(STATE, s);
}

/** next 的本轮: { started, at, until }; null 清掉 (本轮结束)。 */
export function saveRound(round) {
  const s = { ...readJson(STATE) };
  if (round) s.round = round;
  else delete s.round;
  writeJson(STATE, s);
}

/** 记下读到的位置: 每个群一个 head, last 为见过的最大 seq (长连补发用)。 */
export function saveHead(channel, seq) {
  const s = readJson(STATE);
  s.heads = s.heads ?? {};
  s.last = s.last ?? 0;
  if (channel) s.heads[channel] = Math.max(s.heads[channel] ?? 0, seq);
  s.last = Math.max(s.last, seq);
  writeJson(STATE, s);
}

/** 简报缓存: next 按版本只在变化时拿全文。 */
export const loadBrief = () => readJson(BRIEF);
export const saveBrief = (brief) => writeJson(BRIEF, brief);
