#!/usr/bin/env node
// 线上版 (插件体系之前的 main) 升级到插件体系 (#99) 的端到端: 同一份本地数据先用旧版服务端造数据 (seed), 再换新版检查 (check, 可重复跑)
// seed: 装 GitHub 授权 (旧 base 插件 gh) 与待办 1.6, 设仓库规则, 写带 issue 关联 / 父子 / 挂起 / 完成的待办, 开外部接入密钥
// check: 待办字段一条不少 (含 repo, issue, parent, doneAt), gh 迁成 hengxin666.gh 并为主人启用, 规则还在, 旧安装记录没了,
//        待办 Agent 默认能用 issue 接口且专属指令带 issue 一节, 外部接入密钥照用, 旧接口与 pdata 看到同一份数据
// 环境变量: AIOA_SERVER, AIOA_TOKEN, AIOA_PHASE (seed / check), AIOA_STATE (状态文件), AIOA_MARKET_ROOT (市场目录), AIOA_MARKET_PORT
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const server = process.env.AIOA_SERVER;
const token = process.env.AIOA_TOKEN;
const phase = process.env.AIOA_PHASE;
if (!server || !token || !["seed", "check"].includes(phase)) {
  console.error("需要环境变量 AIOA_SERVER, AIOA_TOKEN, AIOA_PHASE=seed|check");
  process.exit(1);
}
const STATE = process.env.AIOA_STATE ?? join(tmpdir(), "aioa-upgrade-main.json");
const ROOT = process.env.AIOA_MARKET_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), "..", "plugins");
const PORT = Number(process.env.AIOA_MARKET_PORT ?? 8797);
const V1 = "/api/v1";
const CH = "plugin-todo";
const TODOS = `${V1}/chats/${CH}/todos`;
const ITEMS = `${V1}/pdata/hengxin666.todo/items`;
const GH = "hengxin666.gh";
let failed = 0;

const market = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(req.url ?? "/")).replace(/^(\.\.[/\\])+/, "");
  res.end(await readFile(join(ROOT, path), "utf8").catch(() => ((res.statusCode = 404), "not found")));
});
await new Promise((ok) => market.listen(PORT, "127.0.0.1", ok));

function check(name, ok, detail = "") {
  console.log(`${ok ? "通过" : "失败"} ${name}${ok ? "" : ` ${JSON.stringify(detail).slice(0, 500)}`}`);
  if (!ok) failed += 1;
}

async function call(bearer, method, path, body) {
  const res = await fetch(server + path, { method, headers: { ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data = text;
  try {
    data = JSON.parse(text);
  } catch {}
  return { status: res.status, data };
}
const api = (m, p, b) => call(token, m, p, b);
const sortById = (list) => [...(list ?? [])].sort((a, b) => a.id.localeCompare(b.id));
// gh 是同步状态, 旧版没连 GitHub 不会有; 其余字段都要原样保留
const canon = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
const strip = (list) => sortById(list).map(({ gh: _g, ...t }) => canon(t));

async function seed() {
  const gh = await api("POST", `${V1}/plugins/gh/install`);
  const inst = await api("POST", `${V1}/plugins/todo/install`);
  check("旧版: 装 GitHub 授权 (base) 与待办", gh.status === 200 && gh.data.install.base === true && inst.status === 200 && inst.data.install.deps?.includes("gh"), [gh.data, inst.data?.install]);
  const rules = await api("PUT", `${V1}/gh/rules`, { pushedDays: 30, repos: ["HengXin666/HX-AIOA"] });
  const key = inst.data?.key;
  const a = await call(key, "POST", TODOS, { todos: [
    { id: "p-1", title: "父任务", repo: "HengXin666/HX-AIOA", issue: 99, prio: 1, src: 5 },
    { id: "c-1", title: "子任务", parent: "p-1", state: "hold", note: "卡住了" },
    { id: "c-2", title: "做完的", parent: "p-1" },
  ] });
  const o = await api("POST", TODOS, { todos: [{ id: "c-2", state: "done" }] });
  const ext = await api("POST", `${V1}/chats/${CH}/todos-ext`, { name: "外部", access: "read", hours: 0 });
  check("旧版: 规则, 待办, 外部接入密钥", rules.status === 200 && a.status === 200 && o.status === 200 && o.data.todos[0]?.doneAt > 0 && ext.status === 200, [rules.data, a.data, o.data, ext.data?.info]);
  const before = sortById((await api("GET", TODOS)).data?.todos);
  writeFileSync(STATE, JSON.stringify({ key, ext: ext.data?.key, keyId: inst.data?.install?.keyId, before }, null, 2));
}

async function verify() {
  const st = JSON.parse(readFileSync(STATE, "utf8"));
  const now = await api("GET", TODOS);
  check("待办一条不少, 字段 (含 repo / issue / parent / hold / doneAt) 与更新时间不变", now.status === 200 && JSON.stringify(strip(now.data.todos)) === JSON.stringify(strip(st.before)), [st.before, now.data]);
  const pl = await api("GET", `${ITEMS}?since=0`);
  const row = pl.data?.items?.find((i) => i.id === `${CH}:p-1`);
  check("pdata 里的行带着关联字段", row?.body?.repo === "HengXin666/HX-AIOA" && row.body.issue === 99 && row.body.channel === CH, row);
  const allow = await api("GET", `${V1}/plugin-allow`);
  check("GitHub 授权迁成 hengxin666.gh, 放行并为主人启用", allow.data?.enabled?.includes(GH) && allow.data.allow?.some((a) => a.id === GH), allow.data?.enabled);
  const plugins = await api("GET", `${V1}/plugins`);
  check("旧 gh 安装记录没了", !plugins.data?.plugins?.some((p) => (p.id === "gh" || p.id === GH) && p.installed), plugins.data?.plugins?.map((p) => [p.id, !!p.installed]));
  const status = await api("GET", `${V1}/gh`);
  check("仓库规则还在", status.status === 200 && status.data.rules?.pushedDays === 30 && status.data.rules.repos?.includes("HengXin666/HX-AIOA"), status.data);
  const me = status.data?.agents?.find((x) => x.keyId === st.keyId);
  check("待办 Agent 默认能用 issue 接口 (清单声明了服务)", me?.allowed === true && me.dep === true, status.data?.agents);
  const guide = await call(st.key, "GET", `${V1}/chat-agent/guide`);
  check("Agent 密钥照用, 专属指令带 pdata 与 GitHub issue 两节", guide.status === 200 && guide.data.includes(ITEMS) && guide.data.includes("### GitHub issue"), guide.status);
  const md = await call(null, "GET", `${V1}/ext/todos.md?key=${st.ext}`);
  check("外部接入密钥照用", md.status === 200 && md.data.includes("父任务"), md.status);
  const done = await call(st.key, "POST", ITEMS, { items: [{ id: `${CH}:c-1`, ver: pl.data.items.find((i) => i.id === `${CH}:c-1`).ver, body: { ...pl.data.items.find((i) => i.id === `${CH}:c-1`).body, state: "done" } }] });
  const c1 = (await api("GET", TODOS)).data?.todos?.find((t) => t.id === "c-1");
  check("Agent 经 pdata 改成完成, 服务端补 doneAt, 旧接口看得到", done.status === 200 && c1?.state === "done" && c1.doneAt > 0, [done.data, c1]);
  // 重复跑 check 时以这次的结果为准 (验证重启后迁移不重跑, 数据不变)
  writeFileSync(STATE, JSON.stringify({ ...st, before: sortById((await api("GET", TODOS)).data?.todos) }, null, 2));
}

if (phase === "seed") await seed();
else if (!existsSync(STATE)) check("先跑 seed", false, STATE);
else await verify();
market.close();
console.log(failed ? `\n${failed} 项失败` : "\n全部通过");
process.exit(failed ? 1 : 0);
