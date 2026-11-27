import assert from "node:assert/strict";
import { test } from "node:test";
import type { RoomMember } from "@hx-aioa/protocol";
import { ROOM_ROUTES, profileChanged } from "../src/api-rooms";
import { OWNER_UID, call, chatCore, memberWho, ownerWho } from "./chat-core";

const CH = "大群";
const path = (q = "") => `/api/v1/chats/${encodeURIComponent(CH)}/members${q}`;

function setup(n: number) {
  const ids = Array.from({ length: n }, (_, i) => `u_${String(i).padStart(2, "0")}`);
  const t = chatCore(ids);
  ids.forEach((id, i) => t.rooms.add(CH, id, "member", 100 + Math.floor(i / 2)));
  t.people.set("u_03", { ...t.people.get("u_03")!, display: "小红", avatar: "abc12345" });
  return { ...t, ids };
}

test("成员分页: 群主只在第一页, cursor 接着翻, 最后一页没有 next (#130)", async () => {
  const t = setup(7);
  const seen: string[] = [];
  let cursor = "";
  let pages = 0;
  for (;;) {
    const r = await call(t.core, ROOM_ROUTES, ownerWho, "GET", path(`?limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`));
    const list = r.body.members as RoomMember[];
    assert.ok(list.length <= 3);
    seen.push(...list.map((m) => m.id));
    pages += 1;
    if (!r.body.next) break;
    cursor = r.body.next as string;
  }
  assert.equal(pages, 3);
  assert.deepEqual(seen, [OWNER_UID, ...t.ids]);
});

test("成员搜索与头像: q 按昵称过滤, 带 avatar; 子号也能看, 群外 403", async () => {
  const t = setup(5);
  const r = await call(t.core, ROOM_ROUTES, memberWho("u_01"), "GET", path("?q=小红"));
  assert.deepEqual(r.body.members, [{ id: "u_03", name: "u_03", display: "小红", role: "member", joined: 101, avatar: "abc12345" }]);
  assert.equal(r.body.next, undefined);
  const out = await call(t.core, ROOM_ROUTES, memberWho("u_99"), "GET", path()).catch((e: Error) => e);
  assert.ok(out instanceof Error);
});

test("成员 ETag: 没变 304, 有人进群或改头像后失效 (#130)", async () => {
  const t = setup(2);
  const a = await call(t.core, ROOM_ROUTES, ownerWho, "GET", path());
  const same = await call(t.core, ROOM_ROUTES, ownerWho, "GET", path(), undefined, { "If-None-Match": a.etag! });
  assert.equal(same.status, 304);
  profileChanged(t.core, "u_00");
  const b = await call(t.core, ROOM_ROUTES, ownerWho, "GET", path(), undefined, { "If-None-Match": a.etag! });
  assert.equal(b.status, 200);
  t.rooms.add(CH, "u_new", "member");
  const c = await call(t.core, ROOM_ROUTES, ownerWho, "GET", path(), undefined, { "If-None-Match": b.etag! });
  assert.equal(c.status, 200);
});

test("共同群 (#139): 子号之间取交集, 不含单聊; 主人与子号是子号在的群; 自己和 key 没有", async () => {
  const t = chatCore(["u_a", "u_b"]);
  t.rooms.add("甲", "u_a", "member");
  t.rooms.add("甲", "u_b", "member");
  t.rooms.add("乙", "u_a", "member");
  t.rooms.add("dm:u_a:u_b", "u_a", "member");
  t.rooms.add("dm:u_a:u_b", "u_b", "member");
  const rooms = (who: Parameters<typeof call>[2], id: string) => call(t.core, ROOM_ROUTES, who, "GET", `/api/v1/users/${id}/rooms`);
  assert.deepEqual((await rooms(memberWho("u_b"), "u_a")).body.channels, ["甲"]);
  assert.deepEqual((await rooms(ownerWho, "u_a")).body.channels, ["乙", "甲"].sort());
  assert.deepEqual((await rooms(memberWho("u_a"), OWNER_UID)).body.channels, ["乙", "甲"].sort());
  assert.deepEqual((await rooms(memberWho("u_a"), "u_a")).body.channels, []);
  const key = { owner: false, key: { id: "k", scopes: [], channels: [] } } as never;
  assert.equal((await rooms(key, "u_a")).status, 403);
});
