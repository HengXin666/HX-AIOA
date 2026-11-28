// HTTP: 统一带密钥与 UA (默认 UA 会被防火墙拦), 429 / 5xx 指数退避
import { HEADER_SKILL, HEADER_SKILL_WANT, formatSkillHeader } from "./proto.mjs";

export const VERSION = "0.5.0";
// 本命令行按哪个协议大版本写的; 握手时带上, 服务端据此给出兼容档位
export const PROTOCOL = 2;
export const USER_AGENT = `hx-aioa-agent/1 hxaioa-cli/${VERSION}`;
const RETRIES = 5;
const BASE_DELAY_MS = 1000;
const RAW_TIMEOUT_MS = 30_000;

export class ApiError extends Error {
  constructor(status, message, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

const GUIDE_HEADER = "X-Aioa-Guide-Version";
let warned = false;
// 见到的新指令版本 (和配置里报到的不同), watch 据此退出码 3
let newer = "";
export const guideChanged = () => newer;
// 最近一个响应里服务端给的应有 skill 版本 (原样的头)
let want = "";
export const seenWant = () => want;

// 服务端每个响应都带当前指令版本; 和上次报到的不同就提示一次 (stderr, 不影响输出); 装了 skill 的不再管专属指令
function checkGuide(cfg, res, path) {
  const v = res.headers.get(GUIDE_HEADER);
  if (cfg.skill || !v || v === cfg.guide || /^\/api\/v1\/chat-agent\/(guide|ack)/.test(path)) return;
  newer = v;
  if (warned) return;
  warned = true;
  process.stderr.write(`专属指令已更新到 ${v}: 先运行 hxaioa guide --ack, 用新全文替换旧指令再继续。\n`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function headers(key, extra = {}) {
  return { Authorization: `Bearer ${key}`, "User-Agent": USER_AGENT, ...extra };
}

function skillHeader(cfg) {
  const s = cfg.skill;
  return s?.skills ? { [HEADER_SKILL]: formatSkillHeader({ setup: s.setup ?? 0, skills: s.skills }) } : {};
}

/** 调接口; 返回 JSON (或 raw=true 时返回 Response)。 */
export async function call(cfg, method, path, body, { raw = false } = {}) {
  if (!cfg.server || !cfg.key) throw new ApiError(0, "还没登录: 先运行 hxaioa login <服务地址> <密钥>");
  const extra = { ...skillHeader(cfg), ...(body === undefined ? {} : { "Content-Type": "application/json" }) };
  const init = { method, headers: headers(cfg.key, extra) };
  if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
  for (let i = 0; ; i++) {
    let res;
    try {
      res = await fetch(cfg.server + path, init);
    } catch (e) {
      if (i >= RETRIES) throw new ApiError(0, `连不上服务端: ${e.message}`);
      await sleep(BASE_DELAY_MS * 2 ** i);
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && i < RETRIES) {
      await sleep(BASE_DELAY_MS * 2 ** i);
      continue;
    }
    checkGuide(cfg, res, path);
    want = res.headers.get(HEADER_SKILL_WANT) || want;
    if (raw && res.ok) return res;
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { error: text.slice(0, 300) };
    }
    if (!res.ok) throw new ApiError(res.status, `${res.status} ${data.error ?? res.statusText}`, data);
    return data;
  }
}

/** 拉 Git raw 或 Releases 上的文件: 不带密钥, 失败重试一次。 */
export async function fetchText(url) {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(RAW_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return await res.text();
    } catch (e) {
      if (i >= 1) throw new ApiError(0, `下载失败: ${e.message}`);
      await sleep(BASE_DELAY_MS);
    }
  }
}

export const enc = encodeURIComponent;
