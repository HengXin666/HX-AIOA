#!/usr/bin/env node
// 开发模式装本地插件: 读插件目录里的 plugin.json, 提示词与介绍, 传到 /api/v1/plugin-dev/{id} (要管理员账号先开开发模式)
// 用法: AIOA_SERVER=... AIOA_TOKEN=<管理员 access token> node tools/plugin-dev.mjs <插件目录> [--off 撤掉]
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const [dir, flag] = process.argv.slice(2);
const server = process.env.AIOA_SERVER;
const token = process.env.AIOA_TOKEN;
if (!dir || !server || !token) {
  console.error("用法: AIOA_SERVER=... AIOA_TOKEN=... node tools/plugin-dev.mjs <插件目录> [--off]");
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(join(dir, "plugin.json"), "utf8"));
const read = (f) => (typeof f === "string" && existsSync(join(dir, f)) ? readFileSync(join(dir, f), "utf8") : undefined);
const path = `${server.replace(/\/+$/, "")}/api/v1/plugin-dev/${encodeURIComponent(manifest.id)}`;
const off = flag === "--off";
const res = await fetch(path, {
  method: off ? "DELETE" : "PUT",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: off ? undefined : JSON.stringify({ manifest, prompt: read(manifest.prompt), readme: read(manifest.readme) }),
});
const text = await res.text();
console.log(res.status, text);
process.exit(res.ok ? 0 : 1);
