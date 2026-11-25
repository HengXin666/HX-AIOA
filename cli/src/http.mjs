// HTTP: 统一带密钥与 UA (默认 UA 会被防火墙拦), 429 / 5xx 指数退避
export const VERSION = "0.3.0";
export const USER_AGENT = `hx-aioa-agent/1 hxaioa-cli/${VERSION}`;
const RETRIES = 5;
const BASE_DELAY_MS = 1000;

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const GUIDE_HEADER = "X-Aioa-Guide-Version";
let warned = false;
// 见到的新指令版本 (和配置里报到的不同), watch 据此退出码 3
let newer = "";
export const guideChanged = () => newer;

// 服务端每个响应都带当前指令版本; 和上次报到的不同就提示一次 (stderr, 不影响输出)
function checkGuide(cfg, res, path) {
  const v = res.headers.get(GUIDE_HEADER);
  if (!v || v === cfg.guide || /^\/api\/v1\/chat-agent\/(guide|ack)/.test(path)) return;
  newer = v;
  if (warned) return;
  warned = true;
  process.stderr.write(`专属指令已更新到 ${v}: 先运行 hxaioa guide --ack, 用新全文替换旧指令再继续。\n`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function headers(key, extra = {}) {
  return { Authorization: `Bearer ${key}`, "User-Agent": USER_AGENT, ...extra };
}

/** 调接口; 返回 JSON (或 raw=true 时返回 Response)。 */
export async function call(cfg, method, path, body, { raw = false } = {}) {
  if (!cfg.server || !cfg.key) throw new ApiError(0, "还没登录: 先运行 hxaioa login <服务地址> <密钥>");
  const init = { method, headers: headers(cfg.key, body === undefined ? {} : { "Content-Type": "application/json" }) };
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
    if (raw && res.ok) return res;
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { error: text.slice(0, 300) };
    }
    if (!res.ok) throw new ApiError(res.status, `${res.status} ${data.error ?? res.statusText}`);
    return data;
  }
}

export const enc = encodeURIComponent;
