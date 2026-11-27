import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_BUNDLE, parseClientFrame, type Envelope, type SendFrame } from "@hx-aioa/protocol";
import { BUNDLE_ROUTES } from "../src/api-bundle";
import { chatInput } from "../src/chat";
import { chatSend } from "../src/chat-send";
import { PROTO_V1 } from "../src/constants";
import type { Attachment } from "../src/sockets";
import { OWNER_UID, call, chatCore, memberWho, ownerWho, said } from "./chat-core";

const send = (extra: Record<string, unknown>) => parseClientFrame(JSON.stringify({ t: "send", cid: "c1", body: { kind: "text", text: "看看" }, ...extra })) as SendFrame;

test("send 帧解析: mentions 去重, bundle 最多 100 条, file 也带上", () => {
  const f = send({ mentions: ["u_a", "u_a", "agent:k1", 3], bundle: { from: "张三和李四", seqs: [3, 1, 3] }, file: "f1" });
  assert.deepEqual(f.mentions, ["u_a", "agent:k1"]);
  assert.deepEqual(f.bundle, { from: "张三和李四", seqs: [3, 1] });
  assert.equal(f.file, "f1");
  assert.equal(send({ bundle: { from: "x", seqs: Array.from({ length: MAX_BUNDLE + 1 }, (_, i) => i + 1) } }).bundle, undefined);
});

test("合并转发: 卡片带条数, refs, 前 4 条摘要 (截 60 字); 撤回的不算 (#132)", () => {
  const t = chatCore();
  const seqs = [1, 2, 3, 4, 5].map((i) => said(t.store, "g", `第 ${i} 条 ${"长".repeat(80)}`).seq);
  const gone = said(t.store, "g", "撤回了");
  t.store.put({ ...gone, seq: 0, deleted: { mode: "recall", at: 1, seq: gone.seq } } as Envelope);
  const input = chatInput(t.store, send({ channel: "g2", bundle: { from: "家里", seqs: [...seqs, gone.seq] } }));
  assert.ok(typeof input !== "string" && input.kind === "event");
  const data = input.data as { title: string; bundle: { count: number; refs: number[]; head: { src: string; text: string }[] } };
  assert.equal(data.title, "[聊天记录] 家里");
  assert.equal(data.bundle.count, 5);
  assert.deepEqual(data.bundle.refs, seqs);
  assert.equal(data.bundle.head.length, 4);
  assert.equal(data.bundle.head[0]?.src, "张三");
  assert.equal(data.bundle.head[0]?.text.length, 60);
});

test("子号只能合并 / 转发自己所在群的消息; 都看不到时报错", () => {
  const t = chatCore(["u_a"]);
  t.rooms.add("g", "u_a", "member");
  const mine = said(t.store, "g", "群里的").seq;
  const secret = said(t.store, "私密", "主人自己的").seq;
  const canSee = (ev: Envelope) => !!t.rooms.member(ev.channel ?? "", "u_a");
  const input = chatInput(t.store, send({ channel: "g", bundle: { from: "x", seqs: [mine, secret] } }), canSee);
  assert.ok(typeof input !== "string");
  assert.deepEqual((input.data as { bundle: { refs: number[] } }).bundle.refs, [mine]);
  assert.equal(chatInput(t.store, send({ channel: "g", bundle: { from: "x", seqs: [secret] } }), canSee), "合并转发的消息都不存在");
  assert.equal(chatInput(t.store, send({ channel: "g", fwd: secret }), canSee), "被转发的消息不存在");
});

test("批量取消息: 最多 100 条, 子号只拿得到自己群的, 撤回的不返回 (#132)", async () => {
  const t = chatCore(["u_a"]);
  t.rooms.add("g", "u_a", "member");
  const a = said(t.store, "g", "一").seq;
  const b = said(t.store, "别的群", "二").seq;
  const all = await call(t.core, BUNDLE_ROUTES, ownerWho, "GET", `/api/v1/events/seq?seqs=${a},${b},999`);
  assert.deepEqual((all.body.events as Envelope[]).map((e) => e.seq), [a, b]);
  const mine = await call(t.core, BUNDLE_ROUTES, memberWho("u_a"), "GET", `/api/v1/events/seq?seqs=${b},${a}`);
  assert.deepEqual((mine.body.events as Envelope[]).map((e) => e.seq), [a]);
  assert.equal((await call(t.core, BUNDLE_ROUTES, ownerWho, "GET", "/api/v1/events/seq?seqs=1,x")).status, 400);
  const many = Array.from({ length: MAX_BUNDLE + 1 }, (_, i) => i + 1).join(",");
  assert.equal((await call(t.core, BUNDLE_ROUTES, ownerWho, "GET", `/api/v1/events/seq?seqs=${many}`)).status, 400);
});

test("@ 提醒: 发出的消息带 mentions, 群里人收到的 ev 里也有 (#131)", async () => {
  const t = chatCore(["u_a"]);
  t.rooms.add("g", "u_a", "member");
  const a = t.connect({ uid: "u_a", member: true });
  const me = t.connect({ uid: OWNER_UID });
  await chatSend(t.core, me, { device: "d", proto: PROTO_V1, role: "client", uid: OWNER_UID } as Attachment, send({ channel: "g", mentions: ["u_a", "agent:k1"] }), null);
  const ev = (a.frames.find((f) => f.t === "ev") as { ev: Envelope }).ev;
  assert.deepEqual(ev.mentions, ["u_a", "agent:k1"]);
  assert.equal(t.store.bySeq(ev.seq)?.mentions?.length, 2);
  assert.equal(me.frames.find((f) => f.t === "sent")?.seq, ev.seq);
});
