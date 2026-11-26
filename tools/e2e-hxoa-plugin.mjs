#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
// hxoa 管理插件 (hengxin666.hxoa, #104) 端到端, 打真实的 hxoa 服务端 (2.4.0+):
// 放行 -> 启用 -> 工作区令牌被拒 -> 错管理令牌被拒 -> 接入 -> 列表在线 (不含令牌) -> 状态 -> 选目录 -> 新建文件夹 -> 加工作区 -> 改开关 -> 发连接令牌 (状态里没有密钥) -> 连接提示 -> 删令牌 -> 删工作区 -> 停用 404 -> purge
// 本机起静态服务充当市场 (仓库 plugins/ 目录), 服务端用 --var PLUGIN_MARKET 指过来
// 环境变量: AIOA_SERVER, AIOA_TOKEN (主人), HXOA_BASE, HXOA_ADMIN (hxoa 面板 远程管理 里建的管理令牌), HXOA_DIR (hxoa 那台机器上可以建测试文件夹的目录), AIOA_MARKET_PORT (默认 8797)
const { AIOA_SERVER: server, AIOA_TOKEN: token, HXOA_BASE: hxBase, HXOA_ADMIN: hxAdmin, HXOA_DIR: hxDir } = process.env;
if (!server || !token || !hxBase || !hxAdmin || !hxDir) {
  console.error("需要环境变量 AIOA_SERVER, AIOA_TOKEN, HXOA_BASE, HXOA_ADMIN, HXOA_DIR");
  process.exit(1);
}
const PORT = Number(process.env.AIOA_MARKET_PORT ?? 8797);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "plugins");
const V1 = "/api/v1";
const ID = "hengxin666.hxoa";
const ALLOW = `${V1}/plugin-allow/${ID}`;
const ENABLED = `${V1}/plugins/${ID}/enabled`;
const HX = `${V1}/hxoa`;
const LABEL = "e2e-agent";
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
check("管理员放行", (await api("PUT", ALLOW, {})).status === 200);
check("主人启用", (await api("PUT", ENABLED)).status === 200);
check("启用后列表为空", (await api("GET", HX)).data?.conns?.length === 0);

check("工作区令牌不能当管理令牌", (await api("POST", HX, { name: "x", base: hxBase, token: "hx_0123456789abcdef" })).status === 400);
const bad = await api("POST", HX, { name: "坏", base: hxBase, token: "hxadm_not-a-real-token" });
check("错管理令牌被 hxoa 拒绝, 不落库", bad.status === 401 && (await api("GET", HX)).data.conns.length === 0, bad);

const add = await api("POST", HX, { name: "e2e", base: hxBase, token: hxAdmin });
check("接入成功并带 hello", add.status === 200 && !!add.data.hello?.server, add.data);
const id = add.data.id;
const list = await api("GET", HX);
check("列表在线, 不含令牌", list.data.conns.length === 1 && !!list.data.conns[0].hello && !JSON.stringify(list.data).includes(hxAdmin), list.data);
const st = await api("GET", `${HX}/${id}/state`);
check("状态", st.status === 200 && Array.isArray(st.data.workspaces), st.data);

const br = await api("GET", `${HX}/${id}/browse?path=${encodeURIComponent(hxDir)}`);
check("选目录", br.status === 200 && Array.isArray(br.data.dirs), br.data);
const folder = `aioa-e2e-${Date.now().toString(36)}`;
const mk = await api("POST", `${HX}/${id}/mkdir`, { parent: hxDir, name: folder });
check("新建文件夹", mk.status === 200 && mk.data.path.endsWith(folder), mk.data);
check("文件夹名带 / 被拒", (await api("POST", `${HX}/${id}/mkdir`, { parent: hxDir, name: "a/b" })).status === 400);
const ws = await api("POST", `${HX}/${id}/workspaces`, { path: mk.data.path, exec: false });
check("加工作区", ws.status === 200 && !!ws.data.id, ws.data);
const wsId = ws.data.id;
check("改开关", (await api("PATCH", `${HX}/${id}/workspaces/${wsId}`, { exec: true })).status === 200);
const nt = await api("POST", `${HX}/${id}/workspaces/${wsId}/tokens`, { label: LABEL });
check("发连接令牌并带连接提示", nt.status === 200 && nt.data.prompt.includes("hxoa --base") && !!nt.data.token?.id, nt.data);
const secret = /--login (\S+)/.exec(nt.data.prompt ?? "")?.[1] ?? "";
const st2 = await api("GET", `${HX}/${id}/state`);
const mine = st2.data.workspaces?.find((w) => w.id === wsId);
check("状态里有新令牌, 没有密钥", mine?.exec === true && mine.tokens.some((t) => t.label === LABEL) && !!secret && !JSON.stringify(st2.data).includes(secret), st2.data);
const pr = await api("GET", `${HX}/${id}/tokens/${nt.data.token.id}/prompt`);
check("连接提示", pr.status === 200 && pr.data.prompt.includes(secret), pr.data);
check("id 不是十六进制被拒", (await api("DELETE", `${HX}/${id}/tokens/..%2Fadmin-tokens`)).status === 400);
check("删连接令牌", (await api("DELETE", `${HX}/${id}/tokens/${nt.data.token.id}`)).status === 200);
check("删工作区", (await api("DELETE", `${HX}/${id}/workspaces/${wsId}`)).status === 200);
check("不存在的接入 404", (await api("GET", `${HX}/nope/state`)).status === 404);

await api("DELETE", ENABLED);
check("停用后 404", (await api("GET", HX)).status === 404 && (await api("GET", `${HX}/${id}/state`)).status === 404);
await api("PUT", ENABLED);
check("再启用接入还在", (await api("GET", HX)).data.conns.length === 1);
const purge = await api("DELETE", `${ENABLED}?purge=1`);
check("停用并清除", purge.status === 200 && purge.data.purged >= 1, purge.data);
await api("PUT", ENABLED);
check("清除后没有接入", (await api("GET", HX)).data.conns.length === 0);
await api("DELETE", ENABLED);

market.close();
console.log(failed ? `\n${failed} 项失败 (hxoa 上的测试文件夹 ${folder} 请手动删)` : `\n全部通过 (hxoa 上留下空文件夹 ${folder}, 可删)`);
process.exit(failed ? 1 : 0);
