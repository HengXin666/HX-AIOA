#!/usr/bin/env node
// 把文件丢进群: node tools/upload.mjs <文件> [群] [说明]
// 环境变量: AIOA_SERVER, AIOA_TOKEN (主人令牌或 Agent 的 key; Agent 只能传到自己的群)
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";

const [file, channel, caption] = process.argv.slice(2);
const server = process.env.AIOA_SERVER;
const token = process.env.AIOA_TOKEN;
if (!file || !server || !token) {
  console.error("用法: AIOA_SERVER=.. AIOA_TOKEN=.. node tools/upload.mjs <文件> [群] [说明]");
  process.exit(1);
}
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
const name = basename(file);
const { size } = await stat(file);
const made = await fetch(`${server}/api/v1/files`, { method: "POST", headers, body: JSON.stringify({ name, size, ...(channel ? { channel } : {}) }) });
const m = await made.json();
if (!made.ok) throw new Error(m.error ?? `登记失败 ${made.status}`);
const put = await fetch(server + m.upload, { method: "PUT", body: await readFile(file) });
if (!put.ok) throw new Error((await put.json().catch(() => ({}))).error ?? `上传失败 ${put.status}`);
const msg = { text: caption || `[文件] ${name}`, file: m.file.id, ...(channel ? { channel } : {}) };
const sent = await fetch(`${server}/api/v1/messages`, { method: "POST", headers, body: JSON.stringify(msg) });
if (!sent.ok) throw new Error((await sent.json().catch(() => ({}))).error ?? `发送失败 ${sent.status}`);
console.log(`已发送 ${name} (${size} 字节)`);
