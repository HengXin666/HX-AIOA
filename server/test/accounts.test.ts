import assert from "node:assert/strict";
import { test } from "node:test";
import type { UserPublic } from "@hx-aioa/protocol";

// Workers 才有 timingSafeEqual, 测试里补一个
const subtle = crypto.subtle as SubtleCrypto & { timingSafeEqual?: (a: ArrayBufferView, b: ArrayBufferView) => boolean };
subtle.timingSafeEqual ??= (a, b) => Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.byteLength), Buffer.from(b.buffer, b.byteOffset, b.byteLength)) === 0;

const { hashPassword, signAccess, verifyAccess, verifyPassword } = await import("../src/accounts/crypto");
const { canInvite, canManage, canSetRole, validName, validPassword } = await import("../src/accounts/rules");

const SECRET = "test-secret";
const PREFIX = "hxa_";
const NOW = 1_763_712_000_000;
const user = (role: UserPublic["role"]): UserPublic => ({ id: `u_${role}`, name: role, display: role, role, status: "active", created: NOW });

test("密码哈希可校验, 错误密码不通过", async () => {
  const stored = await hashPassword("correct-horse");
  assert.ok(stored.startsWith("pbkdf2$"));
  assert.equal(await verifyPassword("correct-horse", stored), true);
  assert.equal(await verifyPassword("wrong-horse", stored), false);
  assert.equal(await verifyPassword("x", "garbage"), false);
});

test("访问令牌: 签名, 过期, 篡改", async () => {
  const token = await signAccess(SECRET, PREFIX, { u: "u_1", s: "s_1", e: NOW + 1000 });
  assert.deepEqual(await verifyAccess(SECRET, PREFIX, token, NOW), { u: "u_1", s: "s_1", e: NOW + 1000 });
  assert.equal(await verifyAccess(SECRET, PREFIX, token, NOW + 1000), null);
  assert.equal(await verifyAccess("other", PREFIX, token, NOW), null);
  const [body, sig] = token.slice(PREFIX.length).split(".");
  const forged = `${PREFIX}${body}x.${sig}`;
  assert.equal(await verifyAccess(SECRET, PREFIX, forged, NOW), null);
  assert.equal(await verifyAccess(SECRET, PREFIX, "hxk_abc", NOW), null);
});

test("用户名与密码校验", () => {
  assert.equal(validName("mom"), true);
  assert.equal(validName("a"), false);
  assert.equal(validName("Heng_Xin"), true);
  assert.equal(validName("heng xin"), false);
  assert.equal(validName("hx.lo-li_1"), true);
  assert.equal(validPassword("1234567"), false);
  assert.equal(validPassword("12345678"), true);
});

test("角色权限: 管理, 邀请, 改角色", () => {
  assert.equal(canManage("owner", user("admin")), true);
  assert.equal(canManage("admin", user("member")), true);
  assert.equal(canManage("admin", user("admin")), false);
  assert.equal(canManage("owner", user("owner")), false);
  assert.equal(canManage("member", user("member")), false);
  assert.equal(canInvite("admin", "member"), true);
  assert.equal(canInvite("admin", "admin"), false);
  assert.equal(canInvite("owner", "admin"), true);
  assert.equal(canInvite("owner", "owner"), false);
  assert.equal(canSetRole("owner", "admin"), true);
  assert.equal(canSetRole("admin", "member"), false);
  assert.equal(canSetRole("owner", "owner"), false);
});
