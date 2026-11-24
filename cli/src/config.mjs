// 配置与进度: ~/.hxaioa/config.json (服务地址 + 密钥, 权限 600) 与 state.json (每个群读到的位置)
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DIR = process.env.HXAIOA_HOME || join(homedir(), ".hxaioa");
const CONFIG = join(DIR, "config.json");
const STATE = join(DIR, "state.json");
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

/** 环境变量优先 (AIOA_SERVER / AIOA_KEY / AIOA_CHANNEL), 其次配置文件。 */
export function loadConfig() {
  const f = readJson(CONFIG);
  const server = (process.env.AIOA_SERVER || f.server || "").replace(/\/+$/, "");
  const key = process.env.AIOA_KEY || f.key || "";
  return { server, key, channel: process.env.AIOA_CHANNEL || f.channel || "", me: f.me };
}

export function saveConfig(cfg) {
  writeJson(CONFIG, { ...readJson(CONFIG), ...cfg });
}

export const configPath = CONFIG;

export function loadState() {
  const s = readJson(STATE);
  return { heads: s.heads ?? {}, last: s.last ?? 0 };
}

/** 记下读到的位置: 每个群一个 head, last 为见过的最大 seq (长连补发用)。 */
export function saveHead(channel, seq) {
  const s = loadState();
  if (channel) s.heads[channel] = Math.max(s.heads[channel] ?? 0, seq);
  s.last = Math.max(s.last, seq);
  writeJson(STATE, s);
}
