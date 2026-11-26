#!/usr/bin/env node
// 插件内核冒烟测试: 用 tools/fixtures/plugin-market 充当市场 (服务端 --var PLUGIN_MARKET 指到本机端口)
// 放行与冲突 (单选, 预算) -> 账号启用与推送 -> pdata 乐观锁, 墓碑, 增量 -> 子号隔离 -> 单选改选 -> Agent 长连秒级收到更新 -> 撤销
// 环境变量: AIOA_SERVER, AIOA_TOKEN, AIOA_MARKET_PORT (默认 8797)
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const server = process.env.AIOA_SERVER;
const token = process.env.AIOA_TOKEN;
if (!server || !token) {
  console.error("需要环境变量 AIOA_SERVER 和 AIOA_TOKEN");
  process.exit(1);
}
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "fixtures", "plugin-market");
const CLI = join(HERE, "..", "cli", "src", "main.mjs");
const PORT = Number(process.env.AIOA_MARKET_PORT ?? 8797);
const V1 = "/api/v1";
const NOTES = "e2e.notes";
const A = "e2e.theme-a";
const B = "e2e.theme-b";
const GREEDY = "e2e.greedy";
const ALL = [NOTES, A, B, GREEDY];
const THEME = "core.theme.base";
const RUN = Date.now().toString(36);
const WAIT_MS = 4000;
let failed = 0;
let bumped = null;

const market = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(req.url ?? "/")).replace(/^(\.\.[/\\])+/, "");
  try {
    let text = await readFile(join(ROOT, path), "utf8");
    if (bumped && path.startsWith(`/${NOTES}/`) && path.endsWith(".json")) text = text.replace(/"version": "[^"]+"/g, `"version": "${bumped}"`);
    // 索引里的版本跟着改, 服务端要求索引与清单版本一致
    if (bumped && path === "/index.json") {
      const idx = JSON.parse(text);
      for (const p of idx.plugins) if (p.id === NOTES) p.version = bumped;
      text = JSON.stringify(idx);
    }
    res.end(text);
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

async function call(bearer, method, path, body) {
  const res = await fetch(server + path, {
    method,
    headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json", "User-Agent": "hx-aioa-agent/1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = text;
  try {
    data = JSON.parse(text);
  } catch {}
  return { status: res.status, data };
}
const api = (m, p, b) => call(token, m, p, b);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function stream(device, bearer = token) {
  const url = new URL(`${V1}/stream`, server.replace(/^http/, "ws"));
  url.searchParams.set("token", bearer);
  url.searchParams.set("device", device);
  const ws = new WebSocket(url);
  const frames = [];
  ws.onmessage = (e) => typeof e.data === "string" && e.data !== "pong" && frames.push(JSON.parse(e.data));
  const next = async (test, wait = WAIT_MS) => {
    const end = Date.now() + wait;
    while (Date.now() < end) {
      const hit = frames.find(test);
      if (hit) return hit;
      await sleep(50);
    }
    return null;
  };
  return { ws, frames, next, open: new Promise((r) => (ws.onopen = r)) };
}

for (const id of ALL) {
  await api("DELETE", `${V1}/plugins/${id}`);
  await api("DELETE", `${V1}/plugin-allow/${id}`);
}

// 放行与冲突
const notes = await api("PUT", `${V1}/plugin-allow/${NOTES}`, {});
check("放行 v2 插件", notes.status === 200 && notes.data.allow.version === "1.0.0", notes.data);
const ta = await api("PUT", `${V1}/plugin-allow/${A}`, {});
check("放行高危插件会标出高危权限", ta.status === 200 && ta.data.allow.risky?.includes("core.replace"), ta.data);
const tb = await api("PUT", `${V1}/plugin-allow/${B}`, {});
check("同一单选扩展点的第二个提供者被拦", tb.status === 409 && tb.data.conflicts?.some((c) => c.kind === "single"), tb.data);
const tb2 = await api("PUT", `${V1}/plugin-allow/${B}`, { defaults: [THEME] });
check("管理员指定默认后放行", tb2.status === 200 && tb2.data.allow.defaults?.includes(THEME), tb2.data);
const badDef = await api("PUT", `${V1}/plugin-allow/${NOTES}`, { defaults: [THEME] });
check("不提供的扩展点不能设默认", badDef.status === 400, badDef.data);
const greedy = await api("PUT", `${V1}/plugin-allow/${GREEDY}`, {});
check("超过每天请求预算的被拦", greedy.status === 409 && greedy.data.conflicts?.some((c) => c.kind === "budget"), greedy.data);

// 账号启用与推送: 界面连接收到, 安卓后台连接不收
const ui = stream(`android-ui-${RUN}`);
const bg = stream(`android-link-${RUN}`);
await Promise.all([ui.open, bg.open]);
const on = await api("PUT", `${V1}/plugins/${NOTES}/enabled`);
check("主人启用", on.status === 200 && on.data.enabled.includes(NOTES), on.data);
const pushed = await ui.next((f) => f.t === "plugin_update" && f.id === NOTES && f.change === "enabled");
check("界面连接收到 plugin_update", !!pushed, ui.frames.map((f) => f.t));
await sleep(300);
check("安卓后台连接不收插件推送", !bg.frames.some((f) => f.t === "plugin_update" || f.t === "pdata_sync"), bg.frames.map((f) => f.t));

// pdata
const P = `${V1}/pdata/${NOTES}/items`;
const c1 = await api("PUT", `${P}/i1-${RUN}`, { ver: 0, body: { title: "买菜", done: false } });
check("新建一行", c1.status === 200 && c1.data.item.ver === 1, c1.data);
check("写入推 pdata_sync", !!(await ui.next((f) => f.t === "pdata_sync" && f.plugin === NOTES && f.coll === "items")), ui.frames.map((f) => f.t));
const stale = await api("PUT", `${P}/i1-${RUN}`, { ver: 0, body: { title: "x" } });
check("ver 不对返回 409 和当前行", stale.status === 409 && stale.data.current?.ver === 1, stale.data);
const badField = await api("PUT", `${P}/i2-${RUN}`, { ver: 0, body: { nope: 1 } });
check("未声明字段被拒", badField.status === 400, badField.data);
const noColl = await api("GET", `${V1}/pdata/${NOTES}/nope`);
check("未声明集合 404", noColl.status === 404, noColl.data);
const l1 = await api("GET", `${P}?since=0&limit=200`);
const del = await api("DELETE", `${P}/i1-${RUN}?ver=1`);
const l2 = await api("GET", `${P}?since=${l1.data.rev}`);
check("删除写墓碑, 增量同步拿到墓碑", del.status === 200 && l2.data.items.length === 1 && l2.data.items[0].deleted === true, [del.data, l2.data]);

// 子号: 看得到白名单但不能放行; 启用前 404, 启用后数据与主人隔离
const inv = await api("POST", `${V1}/invites`, { role: "member" });
const reg = inv.data?.code
  ? await fetch(`${server}${V1}/join`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: inv.data.code, name: `pk${RUN}`, password: "e2e-password-1", display: "PK" }) }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }))
  : { status: 0, data: inv.data };
const M = reg.data?.access;
check("建子号", reg.status === 200 && !!M, reg.data);
if (M) {
  const view = await call(M, "GET", `${V1}/plugin-allow`);
  check("子号看得到白名单, 不是管理员", view.status === 200 && view.data.admin === false && view.data.allow.some((a) => a.id === NOTES), view.data);
  const nope = await call(M, "PUT", `${V1}/plugin-allow/${GREEDY}`, {});
  check("子号不能放行", nope.status === 403, nope.data);
  const before = await call(M, "GET", P);
  check("子号没启用时 404", before.status === 404, before.data);
  const mon = await call(M, "PUT", `${V1}/plugins/${NOTES}/enabled`);
  const mw = await call(M, "PUT", `${P}/m1-${RUN}`, { ver: 0, body: { title: "子号的" } });
  const ml = await call(M, "GET", P);
  const ol = await api("GET", P);
  check("子号启用后数据与主人隔离", mon.status === 200 && mw.status === 200 && ml.data.items.map((i) => i.id).join() === `m1-${RUN}` && !ol.data.items.some((i) => i.id === `m1-${RUN}`), [ml.data, ol.data]);
  const purge = await call(M, "DELETE", `${V1}/plugins/${NOTES}/enabled?purge=1`);
  check("停用并清除数据", purge.status === 200 && purge.data.purged === 1 && !purge.data.enabled.includes(NOTES), purge.data);
}

// 单选扩展点: 管理员默认 B, 账号改选 A
await api("PUT", `${V1}/plugins/${A}/enabled`);
await api("PUT", `${V1}/plugins/${B}/enabled`);
const pick = await api("PUT", `${V1}/plugin-choice/${THEME}`, { plugin: A });
check("账号改选单选扩展点", pick.status === 200 && pick.data.choices[THEME] === A, pick.data);
const wrong = await api("PUT", `${V1}/plugin-choice/commands`, { plugin: A });
check("非单选扩展点不能选", wrong.status === 400, wrong.data);

// Agent 长连: 放行新版后 hxaioa watch --once 秒级醒来
const inst = await api("POST", `${V1}/plugins/${NOTES}/install`);
check("安装 v2 插件 (建群, Agent)", inst.status === 200 && !!inst.data.key, inst.data);
if (inst.data?.key) {
  const home = mkdtempSync(join(tmpdir(), "hxaioa-e2e-"));
  const env = { ...process.env, HXAIOA_HOME: home };
  const run = (args, wait) =>
    new Promise((ok) => {
      const p = spawn(process.execPath, [CLI, ...args], { env });
      let err = "";
      p.stderr.on("data", (d) => (err += d));
      const t = setTimeout(() => p.kill(), wait);
      p.on("exit", (code) => {
        clearTimeout(t);
        ok({ code, err });
      });
    });
  await run(["login", server, inst.data.key], 10_000);
  const started = Date.now();
  const watching = run(["watch", "--once", "--timeout", "30"], 35_000);
  await sleep(2000);
  bumped = "1.0.1";
  const re = await api("PUT", `${V1}/plugin-allow/${NOTES}`, {});
  const w = await watching;
  const took = Date.now() - started;
  // guide 帧 (专属指令版本变了) 与带 guide 的 plugin_update 谁先到都行, 都以退出码 3 醒来
  check("放行新版后 Agent 长连秒级收到", re.status === 200 && w.code === 3 && w.err.includes("guide --ack") && took < 15_000, { code: w.code, err: w.err, took });
  rmSync(home, { recursive: true, force: true });
}

// 撤销默认提供者 B: 剩下 A 一个提供者不需要默认, 撤销前的检查应放行
const stillOver = await api("PUT", `${V1}/plugin-allow/${GREEDY}`, {});
check("预算冲突的插件仍放不进", stillOver.status === 409, stillOver.data);
const svcUser = await api("DELETE", `${V1}/plugin-allow/${B}`);
check("撤掉默认提供者后只剩一个提供者时允许", svcUser.status === 200, svcUser.data);

// 撤销
for (const id of ALL) await api("DELETE", `${V1}/plugin-allow/${id}`);
const end = await api("GET", `${V1}/plugin-allow`);
check("撤销后白名单与启用清空", !end.data.allow.some((a) => ALL.includes(a.id)) && !end.data.enabled.some((id) => ALL.includes(id)), end.data);
const gone = await api("GET", P);
check("撤销后数据接口 404", gone.status === 404, gone.data);

ui.ws.close();
bg.ws.close();
market.close();
console.log(failed ? `\n${failed} 项失败` : "\n全部通过");
process.exit(failed ? 1 : 0);
