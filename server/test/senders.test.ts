import assert from "node:assert/strict";
import { test } from "node:test";
import type { Envelope } from "@hx-aioa/protocol";
import { dropAgentAlias } from "../src/agent-name";
import { markSenders } from "../src/api-senders";
import type { Core } from "../src/core";
import { SenderStore, isSystemSender } from "../src/senders";
import { EventStore } from "../src/store";
import { memSql } from "./sql";

const ev = (id: string, name: string, ts = 1): Envelope =>
  ({ id: `e_${id}_${ts}`, seq: 0, ts, kind: "event", source: { id, name, icon: "bell" }, priority: "happening", data: { title: "x", severity: "normal" } }) as Envelope;

test("系统发送者: 第一次发言登记, 别名替换名字, 普通来源不登记", () => {
  const s = new SenderStore(memSql());
  assert.equal(isSystemSender("system:gh"), true);
  assert.equal(isSystemSender("agent:x"), false);
  s.see(ev("agent:x", "整理员"), 1);
  s.see(ev("system:gh", "GitHub 同步"), 5);
  assert.deepEqual(s.list().map((m) => m.sid), ["system:gh"]);
  assert.equal(s.patch("system:gh", { alias: "  小助手 " }, 6) && s.get("system:gh")?.alias, "小助手");
  const out = s.see(ev("system:gh", "GitHub 同步", 9), 9);
  assert.equal(out.source.name, "小助手");
  assert.equal(s.get("system:gh")?.last, 9);
  assert.equal(s.get("system:gh")?.name, "GitHub 同步");
  assert.equal(typeof s.patch("system:gh", { alias: "名".repeat(40) }), "string");
  assert.equal(s.patch("system:nope", { alias: "a" }), null);
  s.patch("system:gh", { alias: null, avatar: "a".repeat(24) });
  assert.equal(s.get("system:gh")?.alias, undefined);
  assert.equal(s.get("system:gh")?.avatar, "a".repeat(24));
});

test("系统发送者: 旧 sender_meta 并入, 历史消息补登名字与出现时间, 只补一次", () => {
  const sql = memSql();
  const store = new EventStore(sql, (fn) => fn());
  store.put(ev("system:guide", "指令更新", 10));
  store.put(ev("system:guide", "指令更新", 30));
  store.put(ev("终端", "终端", 20));
  store.put(ev("key:k1", "脚本", 20));
  sql.exec("CREATE TABLE sender_meta (sid TEXT PRIMARY KEY, avatar TEXT NOT NULL, updated INTEGER NOT NULL)");
  sql.exec("INSERT INTO sender_meta VALUES ('system:guide', ?, 3)", "b".repeat(24));
  const s = new SenderStore(sql);
  s.backfill();
  const g = s.get("system:guide");
  assert.equal(g?.name, "指令更新");
  assert.equal(g?.avatar, "b".repeat(24));
  assert.equal(g?.last, 30);
  assert.equal(g?.icon, "bell");
  assert.ok(s.get("终端"));
  assert.equal(s.get("key:k1"), null);
  store.put(ev("system:new", "新的", 40));
  s.backfill();
  assert.equal(s.get("system:new"), null);
});

test("Agent 来源 (#121): 补登与改名换头像, 发言按别名, 来源删了头像还在", () => {
  const s = new SenderStore(memSql());
  s.see(ev("src_a", "小助手"), 1);
  assert.equal(s.get("src_a"), null);
  s.syncAgents([{ id: "src_a", name: "小助手", created: 2 }], 3);
  assert.equal(s.get("src_a")?.name, "小助手");
  assert.equal(s.get("src_a")?.first, 2);
  const p = s.patch("src_a", { alias: "研发助理", avatar: "c".repeat(24) }, 4);
  assert.ok(p && typeof p !== "string");
  assert.equal(s.get("src_a")?.avatar, "c".repeat(24));
  assert.equal(s.see(ev("src_a", "小助手", 5), 5, true).source.name, "研发助理");
  assert.equal(s.get("src_a")?.last, 5);
  // 群里改了 Agent 名字: 默认名跟着走, 别名不动
  s.syncAgents([{ id: "src_a", name: "整理员" }], 6);
  assert.equal(s.get("src_a")?.name, "整理员");
  assert.equal(s.get("src_a")?.alias, "研发助理");
  // 来源删了也不丢主人设过的头像
  s.syncAgents([], 8);
  assert.equal(s.get("src_a")?.avatar, "c".repeat(24));
});

test("系统发送者页 (#139): 移出的 Agent 标 gone (行留着保头像), 现有的标 agent; 改名清掉别名", () => {
  const s = new SenderStore(memSql());
  s.syncAgents([{ id: "src_a", name: "小助手" }, { id: "src_b", name: "旧助手" }], 1);
  s.see(ev("system:gh", "GitHub 同步"), 2);
  const frames: unknown[] = [];
  const core = {
    registry: { sources: () => [{ id: "src_a", type: "agent" }, { id: "hook", type: "github" }] },
    pipeline: { senders: s },
    sockets: { toAllClients: (f: unknown) => frames.push(f) },
  } as unknown as Core;
  const marked = new Map(markSenders(core, s.list()).map((m) => [m.sid, m]));
  assert.equal(marked.get("src_a")?.agent, true);
  assert.equal(marked.get("src_b")?.gone, true);
  assert.equal(marked.get("system:gh")?.gone, undefined);
  s.patch("src_a", { alias: "研发助理" });
  dropAgentAlias(core, "src_a", "整理员");
  assert.equal(s.get("src_a")?.alias, undefined);
  assert.equal(s.get("src_a")?.name, "整理员");
  assert.equal(frames.length, 1);
});
