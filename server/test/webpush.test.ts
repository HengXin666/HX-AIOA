import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { isWebDevice, parseWebPushSub, type Envelope } from "@hx-aioa/protocol";
import type { Core, Principal } from "../src/core";
import type { Env } from "../src/env";
import { sendFallback } from "../src/notify";
import { WEBPUSH_ROUTES } from "../src/webpush/api";
import { b64url, concat, encryptPayload, unb64url, VAPID_TTL_SEC, VapidSigner } from "../src/webpush/crypto";
import { payloadOf, WebPush } from "../src/webpush/service";
import { WebPushStore } from "../src/webpush/store";
import { call, memberWho, ownerWho, OWNER_UID } from "./chat-core";
import { ev } from "./fixtures";
import { memSql } from "./sql";

const enc = new TextEncoder();
// RFC 8291 附录 A 的测试向量
const RFC = {
  plain: "When I grow up, I want to be a watermelon",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  // 第 5 节的完整请求体, 以及附录 A 单列的 86 字节头与密文
  out:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT" +
    "pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
  header: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  cipher: "8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ",
};
const ENDPOINT = "https://push.example.com/send/abc";
const SUBJECT = "mailto:ops@example.com";
const WEB = "web-a1b2c3d4";

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: string, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info: enc.encode(info) }, key, bytes * 8));
}

// 按浏览器的做法解密, 验证随机密钥路径
async function decrypt(body: Uint8Array, ua: CryptoKeyPair, auth: Uint8Array): Promise<string> {
  const salt = body.slice(0, 16);
  const idLen = body[20]!;
  const asPublic = body.slice(21, 21 + idLen);
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey));
  const asKey = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, ua.privateKey, 256));
  const ikmKey = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveBits"]);
  const info = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: auth, info }, ikmKey, 256));
  const cek = await hkdf(salt, ikm, "Content-Encoding: aes128gcm\0", 16);
  const nonce = await hkdf(salt, ikm, "Content-Encoding: nonce\0", 12);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, aes, body.slice(21 + idLen)));
  assert.equal(plain[plain.length - 1], 0x02);
  return new TextDecoder().decode(plain.slice(0, -1));
}

async function uaKeys() {
  const ua = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const p256dh = b64url(new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey)));
  return { ua, auth, sub: { endpoint: ENDPOINT, keys: { p256dh, auth: b64url(auth) } } };
}

async function vapidEnv(): Promise<Env> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const pub = b64url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: jwk.d!, VAPID_SUBJECT: SUBJECT } as Env;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

type Sent = { url: string; headers: Record<string, string>; body: Uint8Array };
function mockFetch(status: (url: string) => number): Sent[] {
  const sent: Sent[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    sent.push({ url, headers: init.headers as Record<string, string>, body: init.body as Uint8Array });
    return new Response(null, { status: status(url) });
  }) as typeof fetch;
  return sent;
}

function setup(env: Env, online: string[] = []) {
  const store = new WebPushStore(memSql());
  const web = new WebPush(env, store, (d) => online.includes(d), () => OWNER_UID);
  const core = { env, webpush: web, users: { ownerId: () => OWNER_UID } } as unknown as Core;
  return { store, web, core };
}

test("加密: RFC 8291 附录 A 测试向量逐字节一致", async () => {
  const out = await encryptPayload(enc.encode(RFC.plain), RFC.uaPublic, RFC.auth, { asPrivate: RFC.asPrivate, asPublic: RFC.asPublic, salt: RFC.salt });
  assert.equal(b64url(out), RFC.out);
  assert.equal(b64url(out.slice(0, 86)), RFC.header);
  assert.equal(b64url(out.slice(86)), RFC.cipher);
  assert.equal(out.length, 86 + RFC.plain.length + 1 + 16);
  const uaPub = unb64url(RFC.uaPublic);
  const jwk = { kty: "EC", crv: "P-256", x: b64url(uaPub.slice(1, 33)), y: b64url(uaPub.slice(33)), d: RFC.uaPrivate };
  const ua = { privateKey: await crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]), publicKey: await crypto.subtle.importKey("raw", uaPub, { name: "ECDH", namedCurve: "P-256" }, true, []) };
  assert.equal(await decrypt(out, ua, unb64url(RFC.auth)), RFC.plain);
});

test("加密: 随机临时密钥, 浏览器侧能解开, 每次密文不同", async () => {
  const { ua, auth, sub } = await uaKeys();
  const a = await encryptPayload(enc.encode("你好"), sub.keys.p256dh, sub.keys.auth);
  const b = await encryptPayload(enc.encode("你好"), sub.keys.p256dh, sub.keys.auth);
  assert.notEqual(b64url(a), b64url(b));
  assert.equal(new DataView(a.buffer).getUint32(16), 4096);
  assert.equal(await decrypt(a, ua, auth), "你好");
});

test("VAPID: ES256 JWT 能验签, aud 是推送服务的源, exp 不超过 12 小时, 未过期前复用", async () => {
  const env = await vapidEnv();
  const signer = new VapidSigner(env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!, SUBJECT);
  const now = 1_800_000_000;
  const h = await signer.header(ENDPOINT, now);
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(h);
  assert.ok(m);
  assert.equal(m[2], env.VAPID_PUBLIC_KEY);
  const [head, body, sig] = m[1]!.split(".") as [string, string, string];
  assert.deepEqual(JSON.parse(new TextDecoder().decode(unb64url(head))), { typ: "JWT", alg: "ES256" });
  const claims = JSON.parse(new TextDecoder().decode(unb64url(body))) as { aud: string; exp: number; sub: string };
  assert.deepEqual(claims, { aud: "https://push.example.com", exp: now + VAPID_TTL_SEC, sub: SUBJECT });
  assert.ok(claims.exp - now <= 12 * 3600);
  const pub = await crypto.subtle.importKey("raw", unb64url(env.VAPID_PUBLIC_KEY!), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  assert.ok(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, unb64url(sig), enc.encode(`${head}.${body}`)));
  assert.equal(await signer.header(ENDPOINT, now + 3600), h);
  assert.notEqual(await signer.header(ENDPOINT, now + VAPID_TTL_SEC - 60), h);
  assert.notEqual(await signer.header("https://other.example.com/x", now), h);
});

test("VAPID: 私钥也可以是整个 JWK", async () => {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"])) as CryptoKeyPair;
  const pub = b64url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
  const jwk = JSON.stringify(await crypto.subtle.exportKey("jwk", pair.privateKey));
  assert.match(await new VapidSigner(pub, jwk, SUBJECT).header(ENDPOINT), /^vapid t=/);
});

test("订阅校验: https, 长度上限, base64url, 设备 id 前缀", async () => {
  const { sub } = await uaKeys();
  assert.deepEqual(parseWebPushSub({ ...sub, expirationTime: null }), sub);
  assert.equal(typeof parseWebPushSub({ ...sub, endpoint: "http://push.example.com/x" }), "string");
  assert.equal(typeof parseWebPushSub({ ...sub, endpoint: `https://p.example.com/${"a".repeat(1100)}` }), "string");
  assert.equal(typeof parseWebPushSub({ ...sub, endpoint: "不是地址" }), "string");
  assert.equal(typeof parseWebPushSub({ ...sub, keys: { ...sub.keys, auth: "a+b/" } }), "string");
  assert.equal(typeof parseWebPushSub({ ...sub, keys: { ...sub.keys, p256dh: "abc" } }), "string");
  assert.equal(typeof parseWebPushSub({ endpoint: ENDPOINT }), "string");
  assert.equal(typeof parseWebPushSub(null), "string");
  assert.equal(isWebDevice(WEB), true);
  assert.equal(isWebDevice("android-1"), false);
  assert.equal(isWebDevice("web-a/b"), false);
  assert.equal(isWebDevice(`web-${"a".repeat(80)}`), false);
});

test("接口: 未配置时公钥为 null 且不能订阅, 配置后能订阅, 没变不重写, 取消", async () => {
  const { sub } = await uaKeys();
  const off = setup({} as Env);
  assert.deepEqual((await call(off.core, WEBPUSH_ROUTES, ownerWho, "GET", "/api/v1/webpush/key")).body, { key: null });
  assert.equal((await call(off.core, WEBPUSH_ROUTES, ownerWho, "PUT", `/api/v1/devices/${WEB}/webpush`, sub)).status, 503);

  const env = await vapidEnv();
  const { core, store } = setup(env);
  assert.deepEqual((await call(core, WEBPUSH_ROUTES, ownerWho, "GET", "/api/v1/webpush/key")).body, { key: env.VAPID_PUBLIC_KEY });
  const put = (who: Principal, device: string, body: unknown) => call(core, WEBPUSH_ROUTES, who, "PUT", `/api/v1/devices/${device}/webpush`, body);
  assert.equal((await put(ownerWho, "android-1", sub)).status, 400);
  assert.equal((await put(ownerWho, WEB, { ...sub, endpoint: "http://x.example.com" })).status, 400);
  assert.deepEqual((await put(ownerWho, WEB, sub)).body, { ok: true, changed: true });
  assert.deepEqual((await put(ownerWho, WEB, sub)).body, { ok: true, changed: false });
  assert.equal(store.count(OWNER_UID), 1);
  assert.deepEqual((await put(memberWho("u_b"), "web-b", { ...sub, endpoint: `${ENDPOINT}2` })).body, { ok: true, changed: true });
  assert.equal(store.count("u_b"), 1);
  const keyOnly = { owner: false, key: { id: "k1", scopes: ["messages:send"], channels: [] } } as unknown as Principal;
  assert.equal((await call(core, WEBPUSH_ROUTES, keyOnly, "GET", "/api/v1/webpush/key")).status, 403);
  assert.equal((await put(keyOnly, WEB, sub)).status, 403);
  // 同一个 endpoint 换了设备 id: 旧行作废
  await put(ownerWho, "web-new", sub);
  assert.deepEqual(store.list(OWNER_UID).map((r) => r.device), ["web-new"]);
  assert.deepEqual((await call(core, WEBPUSH_ROUTES, ownerWho, "DELETE", "/api/v1/devices/web-new/webpush")).body, { ok: true, changed: true });
  assert.equal(store.count(OWNER_UID), 0);
});

test("发送: 加密 + VAPID 头, alert 用 high; 404 / 410 删行, 其它错误保留; 页面开着的设备跳过", async () => {
  const env = await vapidEnv();
  const { store, web } = setup(env, ["web-open"]);
  const a = await uaKeys();
  store.put(OWNER_UID, "web-ok", a.sub);
  store.put(OWNER_UID, "web-gone", { ...a.sub, endpoint: "https://push.example.com/gone" });
  store.put(OWNER_UID, "web-404", { ...a.sub, endpoint: "https://push.example.com/missing" });
  store.put(OWNER_UID, "web-500", { ...a.sub, endpoint: "https://push.example.com/boom" });
  store.put(OWNER_UID, "web-open", { ...a.sub, endpoint: "https://push.example.com/open" });
  const sent = mockFetch((u) => (u.endsWith("/gone") ? 410 : u.endsWith("/missing") ? 404 : u.endsWith("/boom") ? 500 : 201));
  const last = ev({ channel: "运维", source: { id: "src_nas", name: "NAS" }, data: { title: "磁盘\n温度过高" } });
  const r = await web.send(last, 3, true);
  assert.deepEqual(r, { sent: 1, dropped: 2, skipped: 1, failed: 1 });
  assert.deepEqual(store.list(OWNER_UID).map((x) => x.device).sort(), ["web-500", "web-ok", "web-open"]);
  assert.equal(sent.length, 4);
  const ok = sent.find((s) => s.url === ENDPOINT)!;
  assert.equal(ok.headers["Content-Encoding"], "aes128gcm");
  assert.equal(ok.headers.Urgency, "high");
  assert.equal(ok.headers.TTL, "86400");
  assert.match(ok.headers.Topic!, /^[A-Za-z0-9_-]{32}$/);
  assert.match(ok.headers.Authorization!, /^vapid t=.+, k=/);
  const payload = JSON.parse(await decrypt(ok.body, a.ua, a.auth)) as Record<string, unknown>;
  assert.deepEqual(payload, { title: "NAS", body: "3 条新消息: 磁盘 温度过高", seq: last.seq, tag: "运维", channel: "运维" });
  mockFetch(() => 201);
  assert.equal((await web.send(last, 1, false)).sent, 2);
});

test("明文: 正文截断, 没有群时 tag 用默认值", () => {
  const p = payloadOf(ev({ source: { id: "x", name: "" }, data: { title: "长".repeat(500) } }), 1);
  assert.equal(p.body.length, 140);
  assert.ok(p.title.length > 0);
  assert.ok(p.tag.length > 0);
});

test("兜底: 未配置 VAPID 或没有订阅时不发 Web Push", async () => {
  const sent = mockFetch(() => 201);
  const { sub } = await uaKeys();
  const job = (web: WebPush) => ({ preview: "x", count: 1, pushToken: undefined, channels: new Set(["webpush" as const]), wxUid: undefined, last: ev() as Envelope, urgent: false, web });
  const off = setup({} as Env);
  off.store.put(OWNER_UID, WEB, sub);
  assert.equal(off.web.ready(), false);
  await sendFallback({} as Env, job(off.web));
  const env = await vapidEnv();
  const empty = setup(env);
  assert.equal(empty.web.ready(), false);
  await sendFallback(env, job(empty.web));
  assert.equal(sent.length, 0);
  empty.store.put(OWNER_UID, WEB, sub);
  assert.equal(empty.web.ready(), true);
  await sendFallback(env, { ...job(empty.web), channels: new Set(["mipush" as const]) });
  assert.equal(sent.length, 0);
  await sendFallback(env, job(empty.web));
  assert.equal(sent.length, 1);
});
