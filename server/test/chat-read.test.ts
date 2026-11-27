import assert from "node:assert/strict";
import { test } from "node:test";
import { AGENT_ACTIVE_FLUSH_MS, AGENT_ACTIVE_STEP_MS, type ChatMeta } from "@hx-aioa/protocol";
import { CHAT_META_ROUTES } from "../src/api-chat-meta";
import { flushActive, touchAgent } from "../src/api-presence";
import { OWNER_UID, call, chatCore, memberWho, ownerWho, said } from "./chat-core";

const CH = "家里";
const ROUTES = CHAT_META_ROUTES;

function setup() {
  const t = chatCore(["u_a", "u_b"]);
  t.rooms.add(CH, "u_a", "member", 10);
  t.chats.patchChat(CH, { title: "家里" }, 100);
  const owner = t.connect({ uid: OWNER_UID });
  const a = t.connect({ uid: "u_a", member: true });
  const b = t.connect({ uid: "u_b", member: true });
  return { ...t, owner, a, b };
}

test("已读: 不改群资料与 updated, 只推 chat_read 给本人设备, 不前进不写 (#129)", async () => {
  const t = setup();
  const rev = t.chats.rev();
  const seq = said(t.store, CH, "你好").seq;
  const r = await call(t.core, ROUTES, ownerWho, "PATCH", `/api/v1/chats/${encodeURIComponent(CH)}`, { read: seq });
  assert.equal(r.status, 200);
  assert.equal((r.body.chat as ChatMeta).read, seq);
  assert.equal(t.chats.rev(), rev);
  assert.equal(t.chats.chat(CH)?.updated, 100);
  assert.deepEqual(t.owner.frames, [{ t: "chat_read", channel: CH, read: seq }]);
  assert.deepEqual(t.a.frames, []);
  await call(t.core, ROUTES, ownerWho, "PATCH", `/api/v1/chats/${encodeURIComponent(CH)}`, { read: seq - 1 });
  assert.equal(t.owner.frames.length, 1);
  const m = await call(t.core, ROUTES, memberWho("u_a"), "PATCH", `/api/v1/chats/${encodeURIComponent(CH)}`, { read: seq });
  assert.equal((m.body.chat as ChatMeta).read, seq);
  assert.deepEqual(t.a.frames, [{ t: "chat_read", channel: CH, read: seq }]);
  assert.equal(t.chats.rev(), rev);
});

test("GET /chats: ETag 用版本号, 没变 304; 改资料或已读后变 (#129)", async () => {
  const t = setup();
  const first = await call(t.core, ROUTES, ownerWho, "GET", "/api/v1/chats");
  assert.ok(first.etag);
  const same = await call(t.core, ROUTES, ownerWho, "GET", "/api/v1/chats", undefined, { "If-None-Match": first.etag! });
  assert.equal(same.status, 304);
  t.chats.reads.mark(OWNER_UID, CH, 5);
  const afterRead = await call(t.core, ROUTES, ownerWho, "GET", "/api/v1/chats", undefined, { "If-None-Match": first.etag! });
  assert.equal(afterRead.status, 200);
  assert.equal((afterRead.body.chats as ChatMeta[])[0]?.read, 5);
  const mem = await call(t.core, ROUTES, memberWho("u_a"), "GET", "/api/v1/chats");
  t.chats.patchChat(CH, { title: "新名字" });
  const changed = await call(t.core, ROUTES, memberWho("u_a"), "GET", "/api/v1/chats", undefined, { "If-None-Match": mem.etag! });
  assert.equal(changed.status, 200);
  assert.equal((changed.body.chats as ChatMeta[])[0]?.title, "新名字");
});

test("chat_sync 带收帧人视图, 只发给群成员与主人 (#129)", async () => {
  const t = setup();
  await call(t.core, ROUTES, ownerWho, "PATCH", `/api/v1/chats/${encodeURIComponent(CH)}`, { title: "改名", pinned: true });
  const toOwner = t.owner.frames.at(-1) as { chat: ChatMeta };
  const toA = t.a.frames.at(-1) as { chat: ChatMeta };
  assert.equal(toOwner.chat.title, "改名");
  assert.equal(toOwner.chat.role, "owner");
  assert.equal(toOwner.chat.pinned, true);
  assert.equal(toA.chat.role, "member");
  assert.equal(toA.chat.pinned, undefined);
  assert.deepEqual(t.b.frames, []);
  // 只改主人自己的置顶: 子号不收
  const n = t.a.frames.length;
  await call(t.core, ROUTES, ownerWho, "PATCH", `/api/v1/chats/${encodeURIComponent(CH)}`, { pinned: false });
  assert.equal(t.a.frames.length, n);
});

test("Agent 活跃: 内存记录推 agent_active, 30 分钟内不落库, 视图合进内存值 (#129)", () => {
  const t = setup();
  t.chats.replaceChat({ ...t.chats.chat(CH)!, agents: [{ keyId: "k1", sourceId: "s1", name: "整理员", reads: [], created: 1, active: 1000 }] });
  const rev = t.chats.rev();
  const now = 1000 + AGENT_ACTIVE_STEP_MS;
  touchAgent(t.core, "k1", now);
  assert.deepEqual(t.owner.frames.at(-1), { t: "agent_active", channel: CH, keyId: "k1", active: now });
  assert.deepEqual(t.a.frames, []);
  assert.equal(t.chats.rev(), rev);
  touchAgent(t.core, "k1", now + 1000);
  assert.equal(t.owner.frames.filter((f) => f.t === "agent_active").length, 1);
  const later = 1000 + AGENT_ACTIVE_FLUSH_MS;
  touchAgent(t.core, "k1", later);
  assert.equal(t.chats.chat(CH)?.agents?.[0]?.active, later);
  t.chats.active.set("k1", later + 5);
  assert.equal(flushActive(t.core), 1);
  assert.equal(t.chats.chat(CH)?.agents?.[0]?.active, later + 5);
  assert.equal(flushActive(t.core), 0);
});

test("keyId 索引随写入更新, 删掉的 Agent 查不到", () => {
  const t = setup();
  t.chats.replaceChat({ channel: "b", updated: 1, agents: [{ keyId: "k2", sourceId: "s", name: "x", reads: [], created: 1 }] });
  assert.equal(t.chats.byKey("k2")?.meta.channel, "b");
  t.chats.replaceChat({ channel: "b", updated: 2, agents: [] });
  assert.equal(t.chats.byKey("k2"), null);
  t.chats.replaceChat({ channel: "c", updated: 3, agents: [{ keyId: "k2", sourceId: "s", name: "x", reads: [], created: 1 }] });
  assert.equal(t.chats.byKey("k2")?.meta.channel, "c");
});

test("推送按账号分组: 群外的子号收不到, 连接断开后不再发", () => {
  const t = setup();
  const ev = said(t.store, CH, "在吗");
  assert.equal(t.core.sockets.deliverEv(ev), 2);
  assert.equal(t.b.frames.length, 0);
  t.core.sockets.reset(t.a);
  assert.equal(t.core.sockets.deliverEv(ev), 1);
});
