import assert from "node:assert/strict";
import { test } from "node:test";
import { parseClientFrame, parseEventInput } from "@hx-aioa/protocol";
import { messageInput } from "../src/api-events";

test("消息与事件可以带 HTML 卡片, 超过 64KB 拒绝", () => {
  const ok = messageInput({ text: "周报", html: "<h1>周报</h1>" });
  assert.equal(typeof ok === "object" && ok.kind === "event" && ok.data.html, "<h1>周报</h1>");
  assert.equal(typeof messageInput({ text: "x", html: "a".repeat(64 * 1024 + 1) }), "string");
  const ev = parseEventInput({ kind: "event", data: { title: "t", html: "<b>x</b>" } });
  assert.ok(ev.ok && ev.value.kind === "event" && ev.value.data.html === "<b>x</b>");
  const rep = parseEventInput({ kind: "report", data: { title: "r", html: "<p>r</p>" } });
  assert.ok(rep.ok && rep.value.kind === "report" && rep.value.data.html === "<p>r</p>");
});

test("主机心跳: 只收 g/y/r/n 且必须带时间", () => {
  const base = { t: "host", subject: "s", info: {} };
  const f = parseClientFrame(JSON.stringify({ ...base, beats: "ggyrn", beatsAt: 5 }));
  assert.ok(f && f.t === "host" && f.beats === "ggyrn" && f.beatsAt === 5);
  const bad = parseClientFrame(JSON.stringify({ ...base, beats: "ggx", beatsAt: 5 }));
  assert.ok(bad && bad.t === "host" && bad.beats === undefined);
  const noAt = parseClientFrame(JSON.stringify({ ...base, beats: "gg" }));
  assert.ok(noAt && noAt.t === "host" && noAt.beats === undefined);
});
