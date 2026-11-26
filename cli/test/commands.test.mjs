import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { fakeServer, home, run } from "./helpers.mjs";

const CFG = { me: { name: "イデア", channel: "g1", sourceId: "agent:1" } };
const ITEMS = "/api/v1/pdata/hengxin666.todo/items/";

test("send --covers: 请求体带 covers 数组, reply 照常", async () => {
  const srv = await fakeServer(() => ({ json: { seq: 900 } }));
  try {
    const r = await run(home(CFG), srv.base, ["send", "已记: 买牛奶", "--reply", "850", "--covers", "849,850,#848"]);
    assert.equal(r.code, 0, r.stderr);
    const q = srv.reqs[0];
    assert.equal(q.path, "/api/v1/messages");
    assert.deepEqual(q.body, { text: "已记: 买牛奶", reply: 850, covers: [849, 850, 848] });
  } finally {
    await srv.close();
  }
});

test("done 与 me --trigger 的请求体", async () => {
  const srv = await fakeServer(({ path }) => {
    if (path === "/api/v1/chat-agent/done") return { json: { cursor: 851, left: 1 } };
    if (path === "/api/v1/chat-agent/trigger") return { json: { trigger: { expr: "every 2h", every: 7200, at: 1, tz: "Asia/Shanghai" } } };
  });
  const dir = home(CFG);
  try {
    const d = await run(dir, srv.base, ["done", "849", "851,852"]);
    assert.equal(d.code, 0, d.stderr);
    assert.deepEqual(srv.reqs[0].body, { seqs: [849, 851, 852] });
    assert.match(d.stdout, /游标 #851, 还剩 1 条/);
    const t = await run(dir, srv.base, ["me", "--trigger", "every 2h"], { TZ: "Asia/Shanghai" });
    assert.deepEqual(srv.reqs[1].body, { expr: "every 2h", tz: "Asia/Shanghai" });
    assert.match(t.stdout, /约每 7200 秒\) 时区 Asia\/Shanghai/);
    assert.equal((await run(dir, srv.base, ["done", "abc"])).code, 1);
  } finally {
    await srv.close();
  }
});

test("todo add: id 用 t-<src>, 占用了加 -2; todo set 冲突时打印当前行并退出 3", async () => {
  const rows = { "g1:t-849": { id: "g1:t-849", ver: 2, rev: 5, updated: 1, body: { channel: "g1", title: "旧的", state: "doing", prio: 1, created: 1 } } };
  const srv = await fakeServer(({ method, path, body }) => {
    if (!path.startsWith(ITEMS)) return undefined;
    const id = decodeURIComponent(path.slice(ITEMS.length));
    const cur = rows[id];
    if (method === "GET") return cur ? { json: { item: cur } } : { status: 404, json: { error: "没有这一行" } };
    if ((cur?.ver ?? 0) !== body.ver || id === "g1:t-x") return { status: 409, json: { error: "版本不对", code: "conflict", current: cur ?? { ...rows["g1:t-849"], id } } };
    rows[id] = { id, ver: body.ver + 1, rev: 6, updated: 2, body: body.body };
    return { json: { item: rows[id] } };
  });
  const dir = home(CFG);
  try {
    const a = await run(dir, srv.base, ["todo", "add", "买牛奶", "--src", "849", "--prio", "3", "--repo", "HengXin666/HX-AIOA", "--issue", "114"]);
    assert.equal(a.code, 0, a.stderr);
    assert.match(a.stdout, /已建: \[待进行\] P3 t-849-2 买牛奶 \(HengXin666\/HX-AIOA#114\)/);
    const b = rows["g1:t-849-2"].body;
    assert.equal(b.channel, "g1");
    assert.equal(b.src, 849);
    assert.equal(typeof b.created, "number");

    const s = await run(dir, srv.base, ["todo", "set", "t-849-2", "--state", "hold", "--repo", ""]);
    assert.equal(s.code, 0, s.stderr);
    assert.equal(rows["g1:t-849-2"].body.state, "hold");
    assert.equal(rows["g1:t-849-2"].body.repo, undefined);
    assert.equal(srv.reqs.at(-1).body.ver, 1);

    const d = await run(dir, srv.base, ["todo", "done", "t-849", "--note", "放弃"]);
    assert.equal(d.code, 0);
    assert.equal(rows["g1:t-849"].body.state, "done");
    assert.equal(rows["g1:t-849"].body.note, "放弃");

    rows["g1:t-x"] = { ...rows["g1:t-849"], id: "g1:t-x" };
    const c = await run(dir, srv.base, ["todo", "set", "t-x", "--prio", "2"]);
    assert.equal(c.code, 3);
    assert.match(c.stdout, /^冲突, 当前是 \(ver 3\): \[已完成\] P1 t-x /m);
  } finally {
    await srv.close();
  }
});

test("todo add/set: 分区, 截止 (东八区), 提醒, 周期, 星标; 空串清掉", async () => {
  const rows = {};
  const srv = await fakeServer(({ method, path, body }) => {
    if (!path.startsWith(ITEMS)) return undefined;
    const id = decodeURIComponent(path.slice(ITEMS.length));
    if (method === "GET") return rows[id] ? { json: { item: rows[id] } } : { status: 404, json: { error: "没有这一行" } };
    rows[id] = { id, ver: body.ver + 1, rev: 1, updated: 1, body: body.body };
    return { json: { item: rows[id] } };
  });
  const dir = home(CFG);
  try {
    const a = await run(dir, srv.base, ["todo", "add", "交电费", "--id", "t-1", "--area", "生活", "--due", "2026-11-30 18:00", "--remind", "1440", "--every", "month", "--star"]);
    assert.equal(a.code, 0, a.stderr);
    const b = rows["g1:t-1"].body;
    assert.equal(b.due, Date.UTC(2026, 10, 30, 10, 0));
    assert.deepEqual(b.every, { unit: "month", n: 1, tz: 480 });
    assert.equal(b.remind, 1440);
    assert.equal(b.star, true);
    assert.match(a.stdout, /交电费 ★ \{生活\} 截止 11-30 18:00 提前1440分提醒 每个月/);
    const s = await run(dir, srv.base, ["todo", "set", "t-1", "--every", "none", "--remind", "", "--due", "2026-12-01"]);
    assert.equal(s.code, 0, s.stderr);
    assert.equal(rows["g1:t-1"].body.every, undefined);
    assert.equal(rows["g1:t-1"].body.remind, undefined);
    assert.equal(rows["g1:t-1"].body.due, Date.UTC(2026, 11, 1, 15, 59));
    const bad = await run(dir, srv.base, ["todo", "set", "t-1", "--every", "hour"]);
    assert.notEqual(bad.code, 0);
  } finally {
    await srv.close();
  }
});

test("命令行常量与协议真源一致", () => {
  const ts = readFileSync(fileURLToPath(new URL("../../protocol/src/v1/agent-skill.ts", import.meta.url)), "utf8");
  for (const s of ['"X-Aioa-Skill"', '"X-Aioa-Want"', '"hx-aioa"', '"https://raw.githubusercontent.com"', "chat-agent/next", "chat-agent/done", "chat-agent/trigger"]) assert.ok(ts.includes(s), s);
});

test("自更新: 同大版本内的新版原子替换, 跨大版本不换", async () => {
  const { selfUpdate } = await import("../src/update.mjs");
  let body = 'var VERSION = "0.4.2";\n';
  const srv = await fakeServer(() => ({ text: body }));
  process.env.HXAIOA_CLI_URL = `${srv.base}/hxaioa.mjs`;
  const file = join(mkdtempSync(join(tmpdir(), "self-")), "hxaioa");
  writeFileSync(file, 'var VERSION = "0.4.0";\n', { mode: 0o755 });
  try {
    assert.equal(await selfUpdate(file, { current: "0.4.0" }), "0.4.2");
    assert.equal(readFileSync(file, "utf8"), body);
    assert.equal(statSync(file).mode & 0o777, 0o755);
    body = 'var VERSION = "0.5.0";\n';
    assert.equal(await selfUpdate(file, { current: "0.4.2" }), "");
    assert.equal(await selfUpdate(file, { current: "0.4.2", sameMajor: false }), "0.5.0");
    body = "<html>not found</html>";
    await assert.rejects(selfUpdate(file, { current: "0.5.0" }));
    assert.match(readFileSync(file, "utf8"), /0\.5\.0/);
  } finally {
    delete process.env.HXAIOA_CLI_URL;
    await srv.close();
  }
});
