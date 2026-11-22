#!/usr/bin/env node
// 拉取式来源: 在家里的机器上定时拉取内网或需要令牌的接口, 每个条目原样交给服务端的 webhook 适配器统一映射。
// 配置格式见 protocol/src/v1/source.ts 的 PullConfig; 密钥只从环境变量读取, 配置文件里用 $变量名 引用。
// 用法: AIOA_PULL_CONFIG=pull.json AIOA_KEY=hxk_... node tools/puller.mjs
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const MIN_PULL_SEC = 60;
const HOOKS_PATH = "/api/v1/hooks";
const DEFAULT_ADAPTER = "generic";
const SEEN_LIMIT = 5000;

const configPath = process.env.AIOA_PULL_CONFIG;
if (!configPath) {
  console.error("需要环境变量 AIOA_PULL_CONFIG (配置文件路径)");
  process.exit(1);
}
const config = JSON.parse(readFileSync(configPath, "utf8"));
const key = process.env[config.keyEnv || "AIOA_KEY"];
if (!config.server || !config.keyId || !key) {
  console.error("配置需要 server, keyId, 且 keyEnv 指向的环境变量要有 key");
  process.exit(1);
}

// 只把变化过的条目发给服务端, 未变化的不重复推送 (服务端也会按 dedupeKey 覆盖)
const seen = new Set();

const expand = (v) => String(v).replace(/\$([A-Z0-9_]+)/g, (_, name) => process.env[name] ?? "");

function pick(obj, path) {
  if (!path) return obj;
  return path.split(".").reduce((cur, seg) => (cur == null ? undefined : cur[Array.isArray(cur) ? Number(seg) : seg]), obj);
}

async function runJob(job) {
  const headers = Object.fromEntries(Object.entries(job.headers ?? {}).map(([k, v]) => [k, expand(v)]));
  const res = await fetch(expand(job.url), { method: job.method ?? "GET", headers });
  if (!res.ok) throw new Error(`拉取失败 ${res.status}`);
  const body = await res.json();
  const found = pick(body, job.itemsPath);
  const items = Array.isArray(found) ? found : [found];
  const hook = `${config.server}${HOOKS_PATH}/${job.adapter ?? DEFAULT_ADAPTER}/${config.keyId}`;
  let sent = 0;
  for (const item of items) {
    const hash = createHash("sha256").update(job.id + JSON.stringify(item)).digest("hex");
    if (seen.has(hash)) continue;
    const r = await fetch(hook, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(item),
    });
    if (!r.ok) throw new Error(`推送失败 ${r.status}: ${await r.text()}`);
    seen.add(hash);
    sent += 1;
  }
  if (seen.size > SEEN_LIMIT) seen.clear();
  console.log(`[${job.id}] 拉到 ${items.length} 条, 推送 ${sent} 条`);
}

for (const job of config.jobs ?? []) {
  const every = Math.max(MIN_PULL_SEC, Number(job.everySec) || MIN_PULL_SEC) * 1000;
  const tick = () => runJob(job).catch((e) => console.error(`[${job.id}]`, e.message));
  tick();
  setInterval(tick, every);
}
