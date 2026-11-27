import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatPresence, RoomMember } from "@hx-aioa/protocol";
import { ROOM_ROUTES } from "../src/api-rooms";
import { OWNER_UID, call, chatCore, memberWho, ownerWho } from "./chat-core";

const CH = "群";
const GET = "GET";
const path = (tail: string) => `/api/v1/chats/${encodeURIComponent(CH)}/${tail}`;

test("成员在线: 前台连接算在线, 后台连接不算, 断开后记最近在线; 会话 seen 取较新的 (#130)", async () => {
  const t = chatCore(["u_a", "u_b", "u_c", "u_x"]);
  for (const id of ["u_a", "u_b", "u_c"]) t.rooms.add(CH, id, "member", 100);
  t.connect({ uid: "u_a", member: true });
  t.connect({ uid: "u_b", member: true, bg: true });
  t.connect({ uid: "u_x", member: true });
  const me = t.connect({ uid: OWNER_UID });
  const gone = t.connect({ uid: "u_c", member: true });
  t.core.sockets.reset(gone);
  Object.assign(t.core.users, { seen: (id: string) => (id === "u_b" ? 1234 : 0) });
  const r = await call(t.core, ROOM_ROUTES, memberWho("u_a"), GET, path("presence"));
  const p = r.body as ChatPresence;
  assert.equal(r.status, 200);
  assert.equal(r.etag, null);
  assert.deepEqual(p.online.sort(), [OWNER_UID, "u_a"].sort());
  assert.equal(p.seen.u_b, 1234);
  assert.ok((p.seen.u_c ?? 0) > 1234);
  assert.equal(p.seen.u_x, undefined);
  t.core.sockets.reset(me);
  const later = (await call(t.core, ROOM_ROUTES, ownerWho, GET, path("presence"))).body as ChatPresence;
  assert.deepEqual(later.online, ["u_a"]);
  assert.ok((later.seen[OWNER_UID] ?? 0) > 0);
});

test("成员在线: 群外的人 403; 成员列表带入群时间, 群主为 0 (#130)", async () => {
  const t = chatCore(["u_a", "u_z"]);
  t.rooms.add(CH, "u_a", "member", 100);
  const out = await call(t.core, ROOM_ROUTES, memberWho("u_z"), GET, path("presence")).catch((e: Error) => e);
  assert.ok(out instanceof Error);
  const list = (await call(t.core, ROOM_ROUTES, ownerWho, GET, path("members"))).body.members as RoomMember[];
  assert.deepEqual(list.map((m) => [m.id, m.joined]), [[OWNER_UID, 0], ["u_a", 100]]);
});
