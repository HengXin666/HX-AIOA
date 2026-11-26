import assert from "node:assert/strict";
import { test } from "node:test";

const { compatOf, parseProtocol, protocolMin, PROTOCOL_WINDOW } = await import("@hx-aioa/protocol");

test("握手三档: 窗口内建议更新, 窗口外灰掉新功能, 没带版本当兼容", () => {
  assert.equal(PROTOCOL_WINDOW, 2);
  assert.equal(protocolMin(3), 2);
  assert.equal(protocolMin(1), 1);
  assert.equal(compatOf(undefined, 3).level, "ok");
  assert.equal(compatOf(3, 3).level, "ok");
  assert.equal(compatOf(4, 3).level, "ok", "客户端比服务端新也照常连");
  assert.equal(compatOf(2, 3).level, "update");
  assert.equal(compatOf(1, 3).level, "floor");
  assert.ok(compatOf(1, 3).msg);
  assert.deepEqual(compatOf(2, 2), { level: "ok", server: 2, min: 1 });
});

test("pv 只认 1 到 4 位正整数", () => {
  assert.equal(parseProtocol("2"), 2);
  for (const bad of [null, "", "0", "-1", "2.5", "abc", "12345"]) assert.equal(parseProtocol(bad), undefined, String(bad));
});
