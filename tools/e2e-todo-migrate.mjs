#!/usr/bin/env node
// 待办迁移 (#101) 端到端: 同一份本地数据先用旧版服务端造数据 (seed), 再换新版服务端检查 (check, 可重复跑, 验证幂等)
// seed: 放行旧 todo, 安装, 主人与 Agent 写待办, 建子号拉进群; check: 待办一条不少, 旧 id 改成新 id, Agent 密钥照用,
// 子号没启用时旧接口 404 (按调用者账号判断), 启用后能读; 管理员放行 2.0.0 后工作台仍是 plugin-todo
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
const STATE = process.env.AIOA_STATE ?? join(tmpdir(), "aioa-todo-migrate.json");
const ROOT = process.env.AIOA_MARKET_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), "..", "plugins");
const PORT = Number(process.env.AIOA_MARKET_PORT ?? 8797);
const V1 = "/api/v1";
const OLD = "todo";
const NEW = "hengxin666.todo";
const CH = `plugin-${OLD}`;
const TODOS = `${V1}/chats/${CH}/todos`;
const ITEMS = `${V1}/pdata/${NEW}/items`;
const RUN = Date.now().toString(36);
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
  const res = await fetch(server + path, { method, headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data = text;
  try {
    data = JSON.parse(text);
  } catch {}
  return { status: res.status, data };
}
const api = (m, p, b) => call(token, m, p, b);
const sortById = (list) => [...(list ?? [])].sort((a, b) => a.id.localeCompare(b.id));

async function seed() {
  await api("DELETE", `${V1}/plugins/${OLD}`);
  const allow = await api("PUT", `${V1}/plugin-allow/${OLD}`, {});
  const inst = await api("POST", `${V1}/plugins/${OLD}/install`);
  check("旧版: 放行并安装 todo", allow.status === 200 && inst.status === 200 && inst.data.install.id === OLD, [allow.data, inst.data]);
  const key = inst.data?.key;
  const a = await call(key, "POST", TODOS, { todos: [{ id: `t-a-${RUN}`, title: "Agent 建的", prio: 1, note: "备注" }, { id: `t-b-${RUN}`, title: "第二条" }] });
  const o = await api("POST", TODOS, { todos: [{ id: `t-b-${RUN}`, state: "done" }] });
  const other = `e2e-mig-${RUN}`;
  await api("POST", `${V1}/messages`, { text: "建群", channel: other });
  const g = await api("POST", `${V1}/chats/${other}/todos`, { todos: [{ id: "x1", title: "别的群的" }] });
  check("旧版: 写待办", a.status === 200 && o.status === 200 && g.status === 200, [a.data, o.data, g.data]);
  const inv = await api("POST", `${V1}/invites`, { role: "member" });
  const reg = await fetch(`${server}${V1}/join`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: inv.data?.code, name: `mig${RUN}`, password: "e2e-password-1", display: "MIG" }) }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));
  const add = await api("POST", `${V1}/chats/${CH}/members`, { user: `mig${RUN}`, role: "member" });
  const m = reg.data?.access;
  const bug = await call(m, "GET", TODOS);
  check("旧版: 子号没启用也能读 (按主人判断的旧 bug)", reg.status === 200 && add.status === 200 && bug.status === 200, [reg.data, add.data, bug.status]);
  const before = { [CH]: sortById((await api("GET", TODOS)).data?.todos), [other]: sortById((await api("GET", `${V1}/chats/${other}/todos`)).data?.todos) };
  writeFileSync(STATE, JSON.stringify({ key, member: m, other, before }, null, 2));
}

async function verify() {
  const st = JSON.parse(readFileSync(STATE, "utf8"));
  for (const [ch, list] of Object.entries(st.before)) {
    const now = await api("GET", `${V1}/chats/${ch}/todos`);
    check(`待办一条不少, 内容与更新时间不变 (${ch})`, now.status === 200 && JSON.stringify(sortById(now.data.todos)) === JSON.stringify(list), [list, now.data]);
  }
  const pl = await api("GET", `${ITEMS}?since=0`);
  const ids = new Set(pl.data?.items?.map((i) => i.id));
  check("待办搬进 pdata, id 是 <群>:<待办 id>", pl.status === 200 && Object.entries(st.before).every(([ch, list]) => list.every((t) => ids.has(`${ch}:${t.id}`))), pl.data);
  if (st.rev !== undefined) check("重启后迁移不重跑, pdata 没有新写入", pl.data?.rev === st.rev && pl.data.items.length === st.count, [st.rev, pl.data?.rev]);
  const plugins = await api("GET", `${V1}/plugins`);
  const mine = plugins.data?.plugins?.find((p) => p.id === NEW);
  check("安装记录与白名单改成新 id, 群与工作台不改名", !!mine?.installed && mine.installed.channel === CH && mine.installed.space === CH && !!mine.allowed && !plugins.data.plugins.some((p) => p.id === OLD && p.installed), mine);
  const chats = await api("GET", `${V1}/chats`);
  check("群里 Agent 的插件 id 改成新 id", chats.data?.chats?.find((c) => c.channel === CH)?.agents?.[0]?.plugin === NEW, chats.data?.chats?.find((c) => c.channel === CH));
  const guide = await call(st.key, "GET", `${V1}/chat-agent/guide`);
  check("Agent 密钥照用, 专属指令的待办说明换成 pdata", guide.status === 200 && guide.data.includes(ITEMS), guide.status);
  const agentRead = await call(st.key, "GET", `${ITEMS}?since=0`);
  check("Agent 用 pdata 读得到待办", agentRead.status === 200 && agentRead.data.items.length === pl.data?.items?.length, agentRead.data);
  const mOff = await call(st.member, "GET", TODOS);
  check("子号没启用待办插件: 旧接口 404 (按调用者账号判断)", mOff.status === 404, mOff.data);
  const en = await call(st.member, "PUT", `${V1}/plugins/${OLD}/enabled`);
  const mOn = await call(st.member, "GET", TODOS);
  check("子号启用 (旧 id 路径) 后能读主人群里的待办", en.status === 200 && en.data.enabled.includes(NEW) && mOn.status === 200 && mOn.data.todos.length === st.before[CH].length, [en.data, mOn.data]);
  await call(st.member, "DELETE", `${V1}/plugins/${NEW}/enabled`);
  if (st.rev === undefined) {
    const up = await api("PUT", `${V1}/plugin-allow/${NEW}`, {});
    const after = await api("GET", `${V1}/plugins/${NEW}`);
    const spaces = await api("GET", `${V1}/spaces`);
    check("放行 2.0.0 后自动更新, 工作台仍是 plugin-todo", up.status === 200 && after.data?.installed?.version === "2.0.0" && spaces.data?.spaces?.some((s) => s.id === CH) && !spaces.data.spaces.some((s) => s.id === `plugin-${NEW}`), [up.data, after.data?.installed]);
    const again = await api("GET", `${ITEMS}?since=0`);
    writeFileSync(STATE, JSON.stringify({ ...st, rev: again.data?.rev, count: again.data?.items?.length }, null, 2));
  }
}

if (phase === "seed") await seed();
else if (!existsSync(STATE)) check("先跑 seed", false, STATE);
else await verify();
market.close();
console.log(failed ? `\n${failed} 项失败` : "\n全部通过");
process.exit(failed ? 1 : 0);
