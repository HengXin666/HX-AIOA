import assert from "node:assert/strict";
import { test } from "node:test";
import { dmChannel, type ChatMeta } from "@hx-aioa/protocol";
import { CHAT_META_ROUTES } from "../src/api-chat-meta";
import { CHAT_ROUTES } from "../src/api-chats";
import { ROOM_ROUTES } from "../src/api-rooms";
import { OWNER_UID, call, chatCore, memberWho, ownerWho, said } from "./chat-core";

const ROUTES = [...CHAT_META_ROUTES, ...CHAT_ROUTES, ...ROOM_ROUTES];
const enc = encodeURIComponent;

test("单聊: channel 按 uid 字典序, 两人都是普通成员, peer 按看的人算, 重复创建不多写 (#133)", async () => {
  const t = chatCore(["u_z"]);
  const owner = t.connect({ uid: OWNER_UID });
  const z = t.connect({ uid: "u_z", member: true });
  const r = await call(t.core, ROUTES, memberWho("u_z"), "POST", "/api/v1/dms", { peer: OWNER_UID });
  const chat = r.body.chat as ChatMeta;
  assert.equal(chat.channel, dmChannel("u_z", OWNER_UID));
  assert.equal(chat.channel, `dm:${OWNER_UID}:u_z`);
  assert.deepEqual([chat.kind, chat.peer, chat.role, chat.members, chat.title], ["dm", OWNER_UID, "member", 2, OWNER_UID]);
  assert.equal((owner.frames.at(-1) as { chat: ChatMeta }).chat.peer, "u_z");
  assert.equal((z.frames.at(-1) as { chat: ChatMeta }).chat.peer, OWNER_UID);
  const rev = t.chats.rev();
  const again = await call(t.core, ROUTES, ownerWho, "POST", "/api/v1/dms", { peer: "u_z" });
  assert.equal((again.body.chat as ChatMeta).channel, chat.channel);
  assert.equal(t.chats.rev(), rev);
});

test("单聊不能接 Agent, 邀请, 加人, 改群资料; 对方必须是已有账号 (#133)", async () => {
  const t = chatCore(["u_z", "u_y"]);
  const ch = dmChannel(OWNER_UID, "u_z");
  await call(t.core, ROUTES, ownerWho, "POST", "/api/v1/dms", { peer: "u_z" });
  for (const [method, path, body] of [
    ["POST", `/api/v1/chats/${enc(ch)}/agents`, { name: "x" }],
    ["POST", `/api/v1/chats/${enc(ch)}/invites`, {}],
    ["POST", `/api/v1/chats/${enc(ch)}/members`, { user: "u_y" }],
    ["PATCH", `/api/v1/chats/${enc(ch)}`, { title: "改名" }],
  ] as const) {
    const r = await call(t.core, ROUTES, ownerWho, method, path, body);
    assert.equal(r.status, 400, path);
    assert.match(r.body.error as string, /^单聊不能/);
  }
  const ok = await call(t.core, ROUTES, ownerWho, "PATCH", `/api/v1/chats/${enc(ch)}`, { pinned: true });
  assert.equal((ok.body.chat as ChatMeta).pinned, true);
  assert.equal((await call(t.core, ROUTES, ownerWho, "POST", "/api/v1/dms", { peer: "nobody" })).status, 404);
  assert.equal((await call(t.core, ROUTES, memberWho("u_z"), "POST", "/api/v1/dms", { peer: "u_z" })).status, 400);
});

test("别人之间的单聊: 主人的群列表与推送里都没有", async () => {
  const t = chatCore(["u_z", "u_y"]);
  const owner = t.connect({ uid: OWNER_UID });
  const y = t.connect({ uid: "u_y", member: true });
  const r = await call(t.core, ROUTES, memberWho("u_z"), "POST", "/api/v1/dms", { peer: "u_y" });
  const ch = (r.body.chat as ChatMeta).channel;
  assert.equal(owner.frames.length, 0);
  const list = await call(t.core, ROUTES, ownerWho, "GET", "/api/v1/chats");
  assert.deepEqual(list.body.chats, []);
  const ev = said(t.store, ch, "悄悄话");
  assert.equal(t.core.sockets.deliverEv(ev), 1);
  assert.equal(owner.frames.length, 0);
  assert.equal(y.frames.at(-1)?.t, "ev");
});

test("群公告: 群主与管理员可改, 普通成员不行, 最多 500 字 (#133)", async () => {
  const t = chatCore(["u_admin", "u_m"]);
  t.rooms.add("g", "u_admin", "admin");
  t.rooms.add("g", "u_m", "member");
  const p = "/api/v1/chats/g";
  assert.equal(((await call(t.core, ROUTES, memberWho("u_admin"), "PATCH", p, { notice: "周五团建" })).body.chat as ChatMeta).notice, "周五团建");
  await call(t.core, ROUTES, memberWho("u_m"), "PATCH", p, { notice: "我改的" });
  assert.equal(t.chats.chat("g")?.notice, "周五团建");
  assert.equal((await call(t.core, ROUTES, ownerWho, "PATCH", p, { notice: "x".repeat(501) })).status, 400);
  await call(t.core, ROUTES, ownerWho, "PATCH", p, { notice: null });
  assert.equal(t.chats.chat("g")?.notice, undefined);
});
