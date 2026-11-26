#!/usr/bin/env node
// 开发模式, 服务端插件 (L2a) 放行, 子号看市场, 握手三档的冒烟测试 (#99)
// 市场用 tools/fixtures/plugin-market (服务端 --var PLUGIN_MARKET 指到本机端口); 环境变量: AIOA_SERVER, AIOA_TOKEN, AIOA_MARKET_PORT (默认 8797)
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
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
const PORT = Number(process.env.AIOA_MARKET_PORT ?? 8797);
const V1 = "/api/v1";
const RUN = Date.now().toString(36);
const DEV = `e2e.dev${RUN}`;
const NOTES = "e2e.notes";
const SERVER_CODE = "e2e.servercode";
const GITHUB = "hengxin666.github";
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

async function call(bearer, method, path, body) {
  const res = await fetch(server + path, {
    method,
    headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
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

function welcome(pv) {
  const url = new URL(`${V1}/stream`, server.replace(/^http/, "ws"));
  url.searchParams.set("token", token);
  url.searchParams.set("device", `android-ui-${RUN}`);
  if (pv) url.searchParams.set("pv", pv);
  const ws = new WebSocket(url);
  return new Promise((ok) => {
    const t = setTimeout(() => (ws.close(), ok(null)), 4000);
    ws.onmessage = (e) => {
      const f = typeof e.data === "string" && e.data !== "pong" ? JSON.parse(e.data) : null;
      if (f?.t !== "welcome") return;
      clearTimeout(t);
      ws.close();
      ok(f);
    };
  });
}

async function member(role) {
  const inv = await api("POST", `${V1}/invites`, { role });
  if (!inv.data?.code) return null;
  const r = await fetch(`${server}${V1}/join`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: inv.data.code, name: `${role.slice(0, 2)}${RUN}`, password: "e2e-password-1", display: role }) });
  return (await r.json().catch(() => null))?.access ?? null;
}

const manifest = async (over = {}) => ({ ...JSON.parse(await readFile(join(ROOT, NOTES, "plugin.json"), "utf8")), id: DEV, name: "开发笔记", contributes: { collections: [{ id: "items", fields: { title: "string" } }] }, ...over });

try {
  // 握手三档
  const ok = await api("GET", `${V1}/compat?pv=2`);
  check("compat: 同版本 ok", ok.status === 200 && ok.data.level === "ok" && ok.data.min === 1, ok.data);
  const old = await api("GET", `${V1}/compat?pv=1`);
  check("compat: 窗口内旧版建议更新", old.data.level === "update" && !!old.data.msg, old.data);
  const none = await api("GET", `${V1}/compat`);
  check("compat: 没带版本当兼容", none.data.level === "ok", none.data);
  const w = await welcome("2");
  check("流的 welcome 带 compat", w?.compat?.level === "ok", w);
  const w0 = await welcome(null);
  check("老客户端不带 pv, welcome 没有 compat", !!w0 && w0.compat === undefined, w0);

  // 服务端插件: 这次部署里没有代码的不能放行
  const sc = await api("PUT", `${V1}/plugin-allow/${SERVER_CODE}`, {});
  check("带服务端代码但没部署的插件放行被拒", sc.status === 409 && sc.data.code === "plugin_needs_deploy", sc.data);
  const view = await api("GET", `${V1}/plugin-allow`);
  check("白名单视图列出编进部署的服务端插件", view.data.server?.includes(GITHUB) && view.data.dev === false, view.data);

  // 开发模式
  const off = await api("PUT", `${V1}/plugin-dev/${DEV}`, { manifest: await manifest(), prompt: "p" });
  check("没开开发模式不能装", off.status === 403 && off.data.code === "plugin_dev_off", off.data);
  const on = await api("PUT", `${V1}/plugin-dev`, { on: true });
  check("开开发模式", on.status === 200 && on.data.on === true, on.data);
  const put = await api("PUT", `${V1}/plugin-dev/${DEV}`, { manifest: await manifest(), prompt: "开发提示词", readme: "# 开发中" });
  check("装开发插件并自动启用", put.status === 200 && put.data.allow.dev === true, put.data);
  const enabled = (await api("GET", `${V1}/plugin-allow`)).data.enabled ?? [];
  check("开发插件为本账号启用", enabled.includes(DEV), enabled);
  const list = await api("GET", `${V1}/plugins`);
  check("市场列表里开发插件排在前面", list.data.plugins?.[0]?.id === DEV && list.data.plugins[0].dev === true, list.data.plugins?.slice(0, 2));
  const det = await api("GET", `${V1}/plugins/${DEV}`);
  check("开发插件详情用快照", det.status === 200 && det.data.readme === "# 开发中" && det.data.task?.includes("开发提示词"), det.data);
  const row = await api("PUT", `${V1}/pdata/${DEV}/items/a1`, { ver: 0, body: { title: "x" } });
  check("开发插件的 pdata 能用", row.status === 200, row.data);
  const v2 = await api("PUT", `${V1}/plugin-dev/${DEV}`, { manifest: await manifest({ version: "1.0.1" }), prompt: "新提示词" });
  check("换版本", v2.status === 200 && v2.data.allow.version === "1.0.1", v2.data);
  const srv = await api("PUT", `${V1}/plugin-dev/${DEV}`, { manifest: await manifest({ server: true, permissions: ["data:own", "net:x.com"] }) });
  check("开发模式不能带服务端代码", srv.status === 400, srv.data);
  await api("PUT", `${V1}/plugin-allow/${NOTES}`, {});
  await api("PUT", `${V1}/plugins/${NOTES}/enabled`);
  const cmds = await api("GET", `${V1}/plugin-contrib/commands`);
  check("扩展点生效贡献: 启用的插件的命令", cmds.status === 200 && cmds.data.card === "multiple" && cmds.data.items.some((i) => i.id === "e2e.notes.add" && i.plugin === NOTES), cmds.data);
  const badPoint = await api("GET", `${V1}/plugin-contrib/nope`);
  check("没有的扩展点 404", badPoint.status === 404, badPoint.data);
  const inMarket = await api("PUT", `${V1}/plugin-dev/e2e.theme-a`, { manifest: { ...(await manifest()), id: "e2e.theme-a" } });
  check("不能占用市场里已有的 id", inMarket.status === 409, inMarket.data);
  const alias = await api("PUT", `${V1}/plugin-dev/todo`, { manifest: { ...(await manifest()), id: "todo" } });
  check("不能用旧别名当 id", alias.status === 400, alias.data);
  const taken = await api("PUT", `${V1}/plugin-dev/${NOTES}`, { manifest: { ...(await manifest()), id: NOTES } });
  check("不能占用已放行的 id", taken.status === 409, taken.data);
  const shadow = await api("PUT", `${V1}/plugin-allow/${DEV}`, {});
  check("开发中的 id 不能走正式放行", shadow.status === 409, shadow.data);

  // 子号: 看市场, 看不到别人的开发插件, 不能开发; 部署级服务端插件启用被拒
  const M = await member("member");
  check("建子号", !!M);
  if (M) {
    const ml = await call(M, "GET", `${V1}/plugins`);
    check("子号能看市场, 没有安装记录", ml.status === 200 && ml.data.admin === false && ml.data.owner === false && ml.data.plugins.every((p) => !p.installed), ml.data);
    check("子号看不到别人的开发插件", !ml.data.plugins?.some((p) => p.id === DEV), ml.data.plugins?.map((p) => p.id));
    const md = await call(M, "GET", `${V1}/plugins/${DEV}`);
    check("子号打开别人的开发插件 404", md.status === 404, md.data);
    const me = await call(M, "PUT", `${V1}/plugins/${DEV}/enabled`);
    check("子号不能启用别人的开发插件", me.status === 403, me.data);
    const mdev = await call(M, "GET", `${V1}/plugin-dev`);
    check("子号不能用开发模式", mdev.status === 403, mdev.data);
    const gh = await call(M, "PUT", `${V1}/plugins/${GITHUB}/enabled`);
    check("部署级服务端插件子号启用被拒", gh.status === 400, gh.data);
    const mn = await call(M, "PUT", `${V1}/plugins/${NOTES}/enabled`);
    check("子号自己启用普通插件", mn.status === 200 && mn.data.enabled.includes(NOTES), mn.data);
  }
  const A = await member("admin");
  if (A) {
    const ad = await call(A, "PUT", `${V1}/plugin-dev`, { on: true });
    check("admin 子号能开开发模式", ad.status === 200 && ad.data.on === true, ad.data);
    const other = await call(A, "PUT", `${V1}/plugin-dev/${DEV}`, { manifest: await manifest() });
    check("别人开发中的 id 不能占", other.status === 409, other.data);
    const AID = `e2e.adm${RUN}`;
    const mineA = await call(A, "PUT", `${V1}/plugin-dev/${AID}`, { manifest: await manifest({ id: AID }) });
    check("admin 子号装自己的开发插件", mineA.status === 200, mineA.data);
    const ownerSees = await api("GET", `${V1}/plugins/${AID}`);
    check("主人打开别人的开发插件 404 (市场里没有)", ownerSees.status === 404 || ownerSees.status === 502, ownerSees.data);
    const cleaned = await api("DELETE", `${V1}/plugin-allow/${AID}`);
    const gone = await call(A, "GET", `${V1}/plugin-dev`);
    check("主人能撤掉别人的开发插件", cleaned.status === 200 && !gone.data.plugins?.some((p) => p.id === AID), [cleaned.data, gone.data]);
    await call(A, "PUT", `${V1}/plugin-dev`, { on: false });
  } else check("建 admin 子号", false);

  const offAll = await api("PUT", `${V1}/plugin-dev`, { on: false });
  const after = await api("GET", `${V1}/plugin-allow`);
  check("关开发模式撤掉全部开发插件", offAll.data.plugins?.length === 0 && !after.data.allow.some((a) => a.id === DEV), [offAll.data, after.data.allow]);
} finally {
  await api("DELETE", `${V1}/plugin-allow/${NOTES}`);
  await api("PUT", `${V1}/plugin-dev`, { on: false });
  market.close();
}
console.log(failed ? `失败 ${failed} 项` : "全部通过");
process.exit(failed ? 1 : 0);
