import assert from "node:assert/strict";
import { test } from "node:test";
import type { Envelope } from "@hx-aioa/protocol";
import { BUNDLE_ROUTES } from "../src/api-bundle";
import type { Principal } from "../src/core";
import type { EventStore } from "../src/store";
import { call, chatCore, memberWho } from "./chat-core";

const GET = "GET";
const card = (store: EventStore, channel: string, id: string, refs: number[]) =>
  store.put({ id, seq: 0, ts: 1, kind: "event", source: { id: "user:张三", name: "张三" }, channel, priority: "happening", data: { title: "[聊天记录] 家里", severity: "normal", bundle: { from: "家里", count: refs.length, refs, head: [] } } } as Envelope).seq;
const said = (store: EventStore, channel: string, text: string) =>
  store.put({ id: `m_${text}`, seq: 0, ts: 1, kind: "event", source: { id: "user:张三", name: "张三" }, channel, priority: "happening", data: { title: text, severity: "normal" } } as Envelope).seq;
const keyWho = (channels: string[]): Principal => ({ owner: false, key: { id: "k1", scopes: ["events:read"], channels } as never });
const seqsOf = (r: { body: Record<string, unknown> }) => ((r.body.events as Envelope[] | undefined) ?? []).map((e) => e.seq);

function world() {
  const t = chatCore(["u_b"]);
  t.rooms.add("x", "u_b", "member");
  const a = said(t.store, "别的群", "一");
  const b = said(t.store, "别的群", "二");
  const secret = said(t.store, "别的群", "没转的");
  const gone = said(t.store, "别的群", "撤回的");
  const inner = card(t.store, "别的群", "inner", [a]);
  const outer = card(t.store, "x", "outer", [a, b, gone, inner]);
  t.store.put({ ...t.store.bySeq(gone)!, seq: 0, deleted: { mode: "recall", at: 1, seq: gone } } as Envelope);
  return { t, a, b, secret, gone, inner, outer };
}

test("via: 能读卡片就能读它 refs 里的别的群消息, 撤回的和不在 refs 里的不给 (#132)", async () => {
  const { t, a, b, secret, gone, outer } = world();
  const who = memberWho("u_b");
  const plain = await call(t.core, BUNDLE_ROUTES, who, GET, `/api/v1/events/seq?seqs=${a},${b}`);
  assert.deepEqual(seqsOf(plain), []);
  const via = await call(t.core, BUNDLE_ROUTES, who, GET, `/api/v1/events/seq?seqs=${a},${b},${gone},${secret}&via=${outer}`);
  assert.equal(via.status, 200);
  assert.deepEqual(seqsOf(via), [a, b]);
  const key = await call(t.core, BUNDLE_ROUTES, keyWho(["x"]), GET, `/api/v1/events/seq?seqs=${a},${b}&via=${outer}`);
  assert.deepEqual(seqsOf(key), [a, b]);
});

test("via: 卡片自己读不到, 不是卡片, 格式不对时拒绝 (#132)", async () => {
  const { t, a, inner, outer } = world();
  const stranger = memberWho("u_c");
  assert.equal((await call(t.core, BUNDLE_ROUTES, stranger, GET, `/api/v1/events/seq?seqs=${a}&via=${outer}`)).status, 403);
  assert.equal((await call(t.core, BUNDLE_ROUTES, keyWho(["y"]), GET, `/api/v1/events/seq?seqs=${a}&via=${outer}`)).status, 403);
  assert.equal((await call(t.core, BUNDLE_ROUTES, memberWho("u_b"), GET, `/api/v1/events/seq?seqs=${a}&via=${a}`)).status, 403);
  assert.equal((await call(t.core, BUNDLE_ROUTES, memberWho("u_b"), GET, `/api/v1/events/seq?seqs=${a}&via=${inner}`)).status, 403);
  assert.equal((await call(t.core, BUNDLE_ROUTES, memberWho("u_b"), GET, `/api/v1/events/seq?seqs=${a}&via=x`)).status, 400);
  assert.equal((await call(t.core, BUNDLE_ROUTES, memberWho("u_b"), GET, `/api/v1/events/seq?seqs=${a}&via=${outer},${inner},${a}`)).status, 400);
});

test("via 链: 内层卡片要在外层 refs 里, 最多两层 (#132)", async () => {
  const { t, a, b, inner, outer } = world();
  const who = memberWho("u_b");
  const nested = await call(t.core, BUNDLE_ROUTES, who, GET, `/api/v1/events/seq?seqs=${a},${b}&via=${outer},${inner}`);
  assert.deepEqual(seqsOf(nested), [a]);
  const other = card(t.store, "别的群", "other", [b]);
  assert.equal((await call(t.core, BUNDLE_ROUTES, who, GET, `/api/v1/events/seq?seqs=${b}&via=${outer},${other}`)).status, 403);
});
