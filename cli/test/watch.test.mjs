// #114 回归: watch 只在消息交给调用方后推进 head, --once 结束后到的消息下次 read --new 还能拿到
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { ev, fakeServer, home, readJsonFile, run } from "./helpers.mjs";

const CFG = { me: { name: "イデア", channel: "g1", sourceId: "agent:1" } };
const ME = { me: CFG.me };

test("定时拉取分支: 同一批两条, --once 只交出第一条, head 停在它", async () => {
  const srv = await fakeServer(({ path, query }) => {
    if (path === "/api/v1/chat-agent/me") return { json: ME };
    if (path === "/api/v1/chats/g1/messages") {
      const all = [ev(848, "自己的", "agent"), ev(849, "第一条"), ev(850, "第二条")].filter((e) => e.seq > Number(query.since));
      return { json: { messages: all, head: 850 } };
    }
  });
  const dir = home(CFG);
  try {
    const w = await run(dir, srv.base, ["watch", "--once", "--timeout", "5"]);
    assert.equal(w.code, 0, w.stderr);
    assert.match(w.stdout, /#849 .*第一条/);
    assert.doesNotMatch(w.stdout, /#850/);
    const st = readJsonFile(join(dir, "state.json"));
    assert.equal(st.heads.g1, 849);
    assert.equal(st.last, 849);

    const r = await run(dir, srv.base, ["read", "--new"]);
    assert.match(r.stdout, /#850 .*第二条/);
    assert.equal(srv.reqs.at(-1).query.since, "849");
  } finally {
    await srv.close();
  }
});

test("长连分支: 连发两条, --once 只交出第一条, last 不越过它", async () => {
  const srv = await fakeServer(({ path }) => (path === "/api/v1/chat-agent/me" ? { json: ME } : undefined), { ws: true });
  srv.srv.on("ws", () =>
    setTimeout(() => {
      srv.push({ t: "ev", ev: ev(849, "第一条") });
      srv.push({ t: "ev", ev: ev(850, "第二条") });
    }, 200),
  );
  const dir = home(CFG);
  try {
    const w = await run(dir, srv.base, ["watch", "--once", "--timeout", "5"]);
    assert.equal(w.code, 0, w.stderr);
    assert.match(w.stdout, /#849/);
    assert.doesNotMatch(w.stdout, /#850/);
    const st = readJsonFile(join(dir, "state.json"));
    assert.equal(st.last, 849);
    assert.equal(st.heads.g1, 849);
  } finally {
    await srv.close();
  }
});

test("--once 等满没消息: 不推进 head", async () => {
  const srv = await fakeServer(({ path }) => {
    if (path === "/api/v1/chat-agent/me") return { json: ME };
    if (path === "/api/v1/chats/g1/messages") return { json: { messages: [], head: 0 } };
  });
  const dir = home(CFG);
  try {
    const w = await run(dir, srv.base, ["watch", "--once", "--timeout", "1"]);
    assert.equal(w.code, 2);
    const p = join(dir, "state.json");
    assert.ok(!existsSync(p) || readJsonFile(p).heads?.g1 === undefined);
  } finally {
    await srv.close();
  }
});
