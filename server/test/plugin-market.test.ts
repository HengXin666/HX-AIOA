import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMarketLink, officialOnly } from "@hx-aioa/protocol";

const RAW = "https://raw.githubusercontent.com";

test("市场链接: 仓库首页先试根目录再试 plugins/", () => {
  const p = parseMarketLink("https://github.com/Foo/bar-plugins");
  assert.ok(typeof p !== "string");
  assert.deepEqual(p.candidates, [`${RAW}/Foo/bar-plugins/HEAD`, `${RAW}/Foo/bar-plugins/HEAD/plugins`]);
  assert.equal(p.id, "foo-bar-plugins");
});

test("市场链接: tree 链接带分支和目录, .git 与 index.json 去掉", () => {
  const p = parseMarketLink("https://github.com/Foo/bar/tree/dev/market/");
  assert.ok(typeof p !== "string");
  assert.deepEqual(p.candidates, [`${RAW}/Foo/bar/dev/market`]);
  assert.equal(p.name, "Foo/bar/market");
  const r = parseMarketLink(`${RAW}/Foo/bar/main/plugins/index.json`);
  assert.ok(typeof r !== "string");
  assert.deepEqual(r.candidates, [`${RAW}/Foo/bar/main/plugins`]);
  const g = parseMarketLink("https://github.com/Foo/bar.git");
  assert.ok(typeof g !== "string" && g.candidates[0] === `${RAW}/Foo/bar/HEAD`);
});

test("市场链接: 拒绝 http 与认不出的 GitHub 链接, 本机 http 放行", () => {
  assert.equal(typeof parseMarketLink("http://example.com/m"), "string");
  assert.equal(typeof parseMarketLink("https://github.com/Foo"), "string");
  assert.equal(typeof parseMarketLink("https://github.com/Foo/bar/issues"), "string");
  assert.notEqual(typeof parseMarketLink("http://127.0.0.1:8798/m"), "string");
});

test("官方命名空间", () => {
  assert.equal(officialOnly("hengxin666.todo"), true);
  assert.equal(officialOnly("foo.todo"), false);
});
