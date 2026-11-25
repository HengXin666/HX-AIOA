#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
// hxoa 接入插件 (hengxin666.hxoa) 端到端, 打真实的 hxoa 服务端: 放行 -> 启用 -> 错令牌被拒 -> 接入 -> 列表在线 (不含令牌) -> ls / read / exec -> 停用后 404 -> 再启用接入还在 -> purge 清空
// 本机起静态服务充当市场 (仓库 plugins/ 目录), 服务端用 --var PLUGIN_MARKET 指过来
// 环境变量: AIOA_SERVER, AIOA_TOKEN (主人), HXOA_BASE, HXOA_TOKEN (hxoa 工作区令牌, 需允许执行命令), AIOA_MARKET_PORT (默认 8797)
const { AIOA_SERVER: server, AIOA_TOKEN: token, HXOA_BASE: hxBase, HXOA_TOKEN: hxToken } = process.env;
if (!server || !token || !hxBase || !hxToken) {
  console.error("需要环境变量 AIOA_SERVER, AIOA_TOKEN, HXOA_BASE, HXOA_TOKEN");
  process.exit(1);
}
const PORT = Number(process.env.AIOA_MARKET_PORT ?? 8797);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "plugins");
const V1 = "/api/v1";
const ID = "hengxin666.hxoa";
const ALLOW = `${V1}/plugin-allow/${ID}`;
const ENABLED = `${V1}/plugins/${ID}/enabled`;
const HX = `${V1}/hxoa`;
let failed = 0;

const market = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(req.url ?? "/")).replace(/^(\.\.[/\\])+/, "");
  try {
    res.end(await readFile(join(ROOT, path), "utf8"));
  } catch {
    res.statusCode = 404;
    res.end("not found");
  }
});
await new Promise((ok) => market.listen(PORT, "127.0.0.1", ok));

function check(name, ok, detail = "") {
  console.log(`${ok ? "通过" : "失败"} ${name}${ok ? "" : ` ${JSON.stringify(detail).slice(0, 400)}`}`);
  if (!ok) failed += 1;
}

async function api(method, path, body) {
  const res = await fetch(server + path, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data = text;
  try {
    data = JSON.parse(text);
  } catch {}
  return { status: res.status, data };
}

await api("DELETE", `${ENABLED}?purge=1`);
check("没启用时 404", (await api("GET", HX)).status === 404);
const allowed = await api("PUT", ALLOW, {});
check("管理员放行", allowed.status === 200, allowed.data);
const on = await api("PUT", ENABLED);
check("主人启用", on.status === 200, on.data);
check("启用后列表为空", (await api("GET", HX)).data?.conns?.length === 0);
const plist = await api("GET", `${V1}/plugins`);
check("插件列表标出已启用 (无 Agent 插件归到已安装)", plist.data?.plugins?.find((p) => p.id === ID)?.enabled === true && !plist.data.plugins.find((p) => p.id === "hengxin666.gh")?.enabled, plist.data);

const bad = await api("POST", HX, { name: "坏", base: hxBase, token: "not-a-real-token-123" });
check("错令牌被 hxoa 拒绝, 不落库", bad.status === 401 && (await api("GET", HX)).data.conns.length === 0, bad);
check("http 地址被拒", (await api("POST", HX, { name: "x", base: "http://example.com", token: hxToken })).status === 400);

const add = await api("POST", HX, { name: "e2e", base: hxBase, token: hxToken });
check("接入成功并带 hello", add.status === 200 && !!add.data.hello?.workspace, add.data);
const id = add.data.id;
const list = await api("GET", HX);
check("列表在线, 不含令牌", list.data.conns.length === 1 && !!list.data.conns[0].hello && !JSON.stringify(list.data).includes(hxToken), list.data);

const ls = await api("GET", `${HX}/${id}/ls?path=&depth=1`);
check("ls 根目录", ls.status === 200 && ls.data.entries.length > 0, ls.data);
const file = ls.data.entries?.find((e) => !e.d)?.p;
const read = file ? await api("GET", `${HX}/${id}/read?path=${encodeURIComponent(file)}&start=1&end=5`) : { status: 0 };
check(`read ${file}`, read.status === 200 && typeof read.data.content === "string", read.data);
const ex = await api("POST", `${HX}/${id}/exec`, { cmd: "echo hxoa-e2e && git rev-parse --abbrev-ref HEAD", timeout: 10 });
check("exec", ex.status === 200 && ex.data.code === 0 && ex.data.stdout.includes("hxoa-e2e"), ex.data);
check("exec 超时上限", (await api("POST", `${HX}/${id}/exec`, { cmd: "true", timeout: 61 })).status === 400);
check("不存在的接入 404", (await api("GET", `${HX}/nope/ls`)).status === 404);

await api("DELETE", ENABLED);
check("停用后 404", (await api("GET", HX)).status === 404 && (await api("POST", `${HX}/${id}/exec`, { cmd: "true" })).status === 404);
await api("PUT", ENABLED);
check("再启用接入还在", (await api("GET", HX)).data.conns.length === 1);
const purge = await api("DELETE", `${ENABLED}?purge=1`);
check("停用并清除", purge.status === 200 && purge.data.purged >= 1, purge.data);
await api("PUT", ENABLED);
check("清除后没有接入", (await api("GET", HX)).data.conns.length === 0);
await api("DELETE", ENABLED);

market.close();
console.log(failed ? `\n${failed} 项失败` : "\n全部通过");
process.exit(failed ? 1 : 0);
