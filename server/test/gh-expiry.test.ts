import { test } from "node:test";
import assert from "node:assert/strict";
import { GhService } from "../src/gh/service";

// 只测 auth() 的 renewable 判断, 存储用内存假实现
function svc(env: Record<string, string | undefined>, secret: Record<string, unknown> | null) {
  const s = new GhService(env as never, { exec: () => ({ toArray: () => [], one: () => null }) } as never);
  (s as unknown as { store: { secret: () => unknown } }).store = { secret: () => secret };
  return s;
}

test("GitHub 授权: 不过期的令牌不带 renewable", () => {
  assert.equal(svc({}, { login: "a", kind: "token", since: 1, token: "x" }).auth()?.renewable, undefined);
});

test("GitHub 授权: 会过期, 有 refresh 和 secret 才能续期", () => {
  const g = { login: "a", kind: "device", since: 1, token: "x", expires: Date.now() + 1000, refresh: "r" };
  assert.equal(svc({ GH_CLIENT_ID: "i", GH_CLIENT_SECRET: "s" }, g).auth()?.renewable, true);
  assert.equal(svc({ GH_CLIENT_ID: "i" }, g).auth()?.renewable, false);
  assert.equal(svc({ GH_CLIENT_ID: "i", GH_CLIENT_SECRET: "s" }, { ...g, refresh: undefined }).auth()?.renewable, false);
  assert.equal(svc({ GH_CLIENT_ID: "i", GH_CLIENT_SECRET: "s" }, { ...g, refreshExpires: 1 }).auth()?.renewable, false);
});
