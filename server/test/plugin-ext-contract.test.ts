import assert from "node:assert/strict";
import { test } from "node:test";
import { memSql } from "./sql";

// 逐扩展点的契约测试 (#99 P5 完成标准): 每个扩展点按基数验证 "校验, 冲突, 生效, 停用, 撤销"
const { EXT_POINTS, PERM_REPLACE, cardOf, parseManifest } = await import("@hx-aioa/protocol");
const { AllowStore } = await import("../src/plugins/allow-store");
const { PluginKernel } = await import("../src/plugins/kernel");
type Point = keyof typeof EXT_POINTS;

const A = "u-a";
const B = "u-b";

function manifest(id: string, point: string, items: Record<string, unknown>[]) {
  const single = cardOf(point as Point) === "single";
  return parseManifest({
    id, name: id, summary: "s", version: "1.0.0", readme: "README.md", prompt: "prompt.md", group: { title: id }, api: "2", engines: { aioa: "^2" },
    ...(single ? { permissions: [PERM_REPLACE] } : {}),
    contributes: { [point]: items },
  });
}

function row(id: string, point: string, items: Record<string, unknown>[], defaults?: string[]) {
  const m = manifest(id, point, items);
  if (typeof m === "string") throw new Error(m);
  return { meta: { id, version: "1.0.0", name: id, by: A, at: 1, ...(defaults ? { defaults } : {}) }, manifest: m, prompt: "" };
}

// 每个扩展点一份贡献 id: 集合只在插件内唯一 (短名), 其余必须以插件 id 开头
const cid = (point: Point, plugin: string, n = "x") => ("scoped" in EXT_POINTS[point] ? n : `${plugin}.${n}`);

function setup(point: Point, defaults?: string[]) {
  const k = new PluginKernel(new AllowStore(memSql()));
  k.put(row("p.one", point, [{ id: cid(point, "p.one") }], defaults));
  k.put(row("p.two", point, [{ id: cid(point, "p.two") }]));
  for (const u of [A, B]) for (const p of ["p.one", "p.two"]) k.setEnabled(u, p, true);
  return k;
}

const ids = (k: InstanceType<typeof PluginKernel>, u: string, p: Point) => k.contributions(u, p).map((e) => e.plugin).sort();

test("契约表覆盖全部扩展点: 新加扩展点必须在这里补测试", () => {
  assert.deepEqual(Object.keys(EXT_POINTS).sort(), [...POINTS].sort());
});

const POINTS = Object.keys(EXT_POINTS) as Point[];

for (const point of POINTS) {
  const card = cardOf(point);

  test(`${point} (${card}): 清单校验`, () => {
    if ("scoped" in EXT_POINTS[point]) assert.match(String(manifest("p.one", point, [{ id: "Bad Name" }])), /集合名/);
    else assert.match(String(manifest("p.one", point, [{ id: "other.x" }])), /必须以插件 id/);
    assert.match(String(manifest("p.one", point, [{ id: cid(point, "p.one") }, { id: cid(point, "p.one") }])), /重复/);
    if (card === "single") {
      const m = parseManifest({ id: "p.one", name: "n", summary: "s", version: "1.0.0", readme: "README.md", prompt: "prompt.md", group: { title: "t" }, api: "2", engines: { aioa: "^2" }, contributes: { [point]: [{ id: "p.one.x" }] } });
      assert.match(String(m), /core\.replace/);
    }
  });

  test(`${point} (${card}): 冲突检测, 生效裁决, 停用与撤销`, () => {
    if (card === "single") {
      const k0 = new PluginKernel(new AllowStore(memSql()));
      k0.put(row("p.one", point, [{ id: "p.one.x" }]));
      assert.ok(k0.check(row("p.two", point, [{ id: "p.two.x" }])).conflicts.some((c) => c.kind === "single"), "两个提供者没有默认要报冲突");
      const k = setup(point, [point]);
      assert.deepEqual(ids(k, A, point), ["p.one"], "管理员默认");
      assert.equal(k.choose(A, point, "p.two"), null);
      assert.deepEqual(ids(k, A, point), ["p.two"], "账号改选");
      assert.deepEqual(ids(k, B, point), ["p.one"], "改选只影响本账号");
      k.setEnabled(A, "p.two", false);
      assert.deepEqual(ids(k, A, point), ["p.one"], "停用后回到默认");
      k.setEnabled(B, "p.one", false);
      assert.deepEqual(ids(k, B, point), ["p.two"], "唯一启用者");
      k.revoke("p.two");
      assert.deepEqual(ids(k, B, point), [], "撤销后不再生效");
      return;
    }
    const k = setup(point);
    assert.deepEqual(k.check().conflicts, [], "各自命名空间不冲突");
    assert.deepEqual(ids(k, A, point), ["p.one", "p.two"]);
    k.setEnabled(A, "p.one", false);
    assert.deepEqual(ids(k, A, point), ["p.two"], "停用只影响本账号");
    assert.deepEqual(ids(k, B, point), ["p.one", "p.two"]);
    k.revoke("p.two");
    assert.deepEqual(ids(k, B, point), ["p.one"], "撤销按插件撤掉全部注册");
    assert.equal(k.choose(A, point, "p.one"), `${point} 不是单选扩展点或服务`, "非单选不能改选");
  });

  if (card === "pipeline") {
    test(`${point} (pipeline): before / after 排序与成环, 同写一字段必须声明先后`, () => {
      const k = new PluginKernel(new AllowStore(memSql()));
      k.put(row("p.one", point, [{ id: "p.one.x", after: ["p.two.x"] }]));
      k.put(row("p.two", point, [{ id: "p.two.x" }]));
      k.setEnabled(A, "p.one", true);
      k.setEnabled(A, "p.two", true);
      assert.deepEqual(k.contributions(A, point).map((e) => e.c.id), ["p.two.x", "p.one.x"]);
      const cyc = k.check(row("p.two", point, [{ id: "p.two.x", after: ["p.one.x"] }]));
      assert.ok(cyc.conflicts.some((c) => c.kind === "order"), "成环要报");
      const race = k.check(row("p.three", point, [{ id: "p.three.x", writes: ["route"] }]));
      assert.deepEqual(race.conflicts, []);
      k.put(row("p.three", point, [{ id: "p.three.x", writes: ["route"] }]));
      const both = k.check(row("p.four", point, [{ id: "p.four.x", writes: ["route"] }]));
      assert.ok(both.conflicts.some((c) => c.kind === "order"), "两个都写 route 却没先后要报");
    });
  }
}
