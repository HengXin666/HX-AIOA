import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeEnvelope, pick, renderTemplate, type EventData, type EventInput } from "@hx-aioa/protocol";
import { parseHookBody, runAdapter } from "../src/adapters";
import { ev } from "./fixtures";

const src = { name: "测试" };
const data = (e: EventInput | undefined) => e?.data as EventData;
const one = (r: EventInput[] | string): EventInput => {
  assert.ok(Array.isArray(r) && r[0], `应返回事件: ${String(r)}`);
  return r[0];
};

test("GitHub: CI 失败需要我, 成功以同一 dedupeKey 恢复", () => {
  const headers = new Headers({ "X-GitHub-Event": "workflow_run" });
  const run = (conclusion: string) => ({ action: "completed", repository: { full_name: "HengXin666/HX-AIOA" }, workflow_run: { name: "ci", head_branch: "main", conclusion, html_url: "https://x" } });
  const fail = one(runAdapter("github", { body: run("failure"), headers, source: src }));
  const ok = one(runAdapter("github", { body: run("success"), headers, source: src }));
  assert.equal(fail.priority, "need_me");
  assert.equal(fail.dedupeKey, ok.dedupeKey);
  assert.equal(fail.subject, "github:HengXin666/HX-AIOA");
  assert.equal(fail.channel, "github/hx-aioa");
  assert.equal(ok.resolved, true);
  assert.deepEqual(runAdapter("github", { body: { action: "requested" }, headers, source: src }), []);
});

test("Uptime Kuma: 掉线紧急, 恢复覆盖同一条, 按主机分组", () => {
  const body = (status: number) => ({ heartbeat: { status, msg: "timeout" }, monitor: { id: 7, name: "博客", url: "https://blog.example.com/" } });
  const down = one(runAdapter("uptime-kuma", { body: body(0), headers: new Headers(), source: src }));
  const up = one(runAdapter("uptime-kuma", { body: body(1), headers: new Headers(), source: src }));
  assert.equal(data(down).severity, "critical");
  assert.equal(down.groupKey, "host:blog.example.com");
  assert.equal(down.dedupeKey, up.dedupeKey);
  assert.equal(up.resolved, true);
});

test("Beszel: 从标题取出系统名与指标", () => {
  const e = one(runAdapter("beszel", { body: { title: "CPU usage above threshold on nas", message: "95%" }, headers: new Headers(), source: src }));
  assert.equal(e.subject, "nas");
  assert.equal(e.dedupeKey, "beszel:nas:cpu");
  const down = one(runAdapter("beszel", { body: { title: "Connection to vps is down" }, headers: new Headers(), source: src }));
  assert.equal(down.subject, "vps");
  assert.equal(data(down).severity, "critical");
});

test("Healthchecks: 表单请求体也能解析", () => {
  const body = parseHookBody("name=backup&status=down&code=abc", "application/x-www-form-urlencoded", new URLSearchParams());
  const e = one(runAdapter("healthchecks", { body, headers: new Headers(), source: src }));
  assert.equal(data(e).severity, "critical");
  assert.equal(e.dedupeKey, "hc:abc");
});

test("通用 Webhook: 映射模板, 事件格式直通, 兜底摘要", () => {
  const mapping = { title: "[{{host}}] {{alert.name}}", severity: "{{level}}", dedupeKey: "{{alert.id}}", status: "{{state}}" };
  const e = one(runAdapter("generic", { body: { host: "nas", level: "ERROR", state: "ok", alert: { id: 3, name: "磁盘" } }, headers: new Headers(), source: { ...src, mapping } }));
  assert.equal(data(e).title, "[nas] 磁盘");
  assert.equal(data(e).severity, "critical");
  assert.equal(e.dedupeKey, "3");
  assert.equal(e.resolved, true);
  const direct = one(runAdapter("generic", { body: { title: "备份完成", severity: "info" }, headers: new Headers(), source: src }));
  assert.equal(data(direct).title, "备份完成");
  const raw = one(runAdapter("generic", { body: { foo: 1 }, headers: new Headers(), source: src }));
  assert.equal(data(raw).title, "测试");
});

test("模板与合并工具", () => {
  assert.equal(pick({ a: [{ b: 2 }] }, "a.0.b"), 2);
  assert.equal(renderTemplate("{{a.0.b}}", { a: [{ b: 2 }] }), 2);
  assert.equal(renderTemplate("x={{a}}", { a: 1 }), "x=1");
  const a = ev({ id: "x", seq: 1 });
  const b = ev({ id: "y", seq: 2 });
  const merged = mergeEnvelope([a, b], { ...a, seq: 3 });
  assert.deepEqual(merged.map((e) => `${e.id}:${e.seq}`), ["y:2", "x:3"]);
});
