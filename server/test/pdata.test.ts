import assert from "node:assert/strict";
import { test } from "node:test";
import { memSql } from "./sql";

const { MAX_PDATA_ROWS } = await import("@hx-aioa/protocol");
const { PDataStore, checkBody } = await import("../src/plugins/pdata");

const A = "u1";
const P = "a.x";
const C = "items";

test("乐观锁: 新建 ver 0, 改要带当前 ver, 不对返回当前行", () => {
  const s = new PDataStore(memSql());
  const r1 = s.put(A, P, C, "i1", 0, { t: 1 });
  assert.ok("ok" in r1 && r1.ok.ver === 1);
  const bad = s.put(A, P, C, "i1", 0, { t: 2 });
  assert.ok("conflict" in bad && bad.conflict?.ver === 1);
  const r2 = s.put(A, P, C, "i1", 1, { t: 2 });
  assert.ok("ok" in r2 && r2.ok.ver === 2);
  const same = s.put(A, P, C, "i1", 2, { t: 2 });
  assert.ok("ok" in same && same.ok.rev === ("ok" in r2 ? r2.ok.rev : -1));
});

test("墓碑与增量同步", () => {
  const s = new PDataStore(memSql());
  s.put(A, P, C, "i1", 0, { t: 1 });
  s.put(A, P, C, "i2", 0, { t: 2 });
  const first = s.list(A, P, C, 0);
  assert.equal(first.items.length, 2);
  const del = s.remove(A, P, C, "i1", 1);
  assert.ok("ok" in del && del.ok.deleted);
  const next = s.list(A, P, C, first.rev);
  assert.deepEqual(next.items.map((i) => [i.id, i.deleted ?? false]), [["i1", true]]);
  const re = s.put(A, P, C, "i1", 2, { t: 3 });
  assert.ok("ok" in re && re.ok.ver === 3 && !re.ok.deleted);
  const page = s.list(A, P, C, 0, 1);
  assert.ok(page.more && page.items.length === 1);
});

test("隔离: 账号和插件互不可见, 清除只清自己的", () => {
  const s = new PDataStore(memSql());
  s.put(A, P, C, "i1", 0, {});
  s.put("u2", P, C, "i1", 0, {});
  s.put(A, "b.y", C, "i1", 0, {});
  assert.equal(s.list("u2", P, C).items.length, 1);
  assert.equal(s.purge(A, P), 1);
  assert.equal(s.list(A, P, C).items.length, 0);
  assert.equal(s.list(A, "b.y", C).items.length, 1);
});

test("配额与字段校验", () => {
  const s = new PDataStore(memSql());
  for (let i = 0; i < MAX_PDATA_ROWS; i++) s.put(A, P, C, `i${i}`, 0, {});
  assert.ok("error" in s.put(A, P, C, "over", 0, {}));
  s.remove(A, P, C, "i0", 1);
  assert.ok("error" in s.put(A, P, C, "over2", 0, {}), "墓碑也占配额");
  assert.ok("ok" in s.put(A, P, C, "i0", 2, {}), "复活自己的墓碑不受配额影响");
  const coll = { id: C, fields: { title: "string" as const, done: "boolean" as const } };
  assert.equal(checkBody(coll, { title: "x", done: false }), null);
  assert.match(String(checkBody(coll, { title: 1 })), /string/);
  assert.match(String(checkBody(coll, { other: 1 })), /没有声明/);
  assert.match(String(checkBody(coll, [])), /对象/);
  assert.match(String(checkBody(coll, JSON.parse('{"constructor":null}'))), /没有声明/);
});

test("清除后 rev 继续增长, 增量同步不漏新写入", () => {
  const s = new PDataStore(memSql());
  s.put(A, P, C, "i1", 0, {});
  s.put(A, P, C, "i2", 0, {});
  const seen = s.list(A, P, C, 0).rev;
  s.purge(A, P);
  s.put(A, P, C, "i3", 0, {});
  assert.deepEqual(s.list(A, P, C, seen).items.map((i) => i.id), ["i3"]);
});
