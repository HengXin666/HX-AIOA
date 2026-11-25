// AIOA + HX-CF-Drive 联调: 本机 wrangler dev 两个 Worker (Service Binding) + mock-tg
import { createHash, randomBytes } from "node:crypto";

const A = process.env.AIOA ?? "http://127.0.0.1:28790";
const D = process.env.DRIVE ?? "http://127.0.0.1:28787";
const TOKEN = process.env.AUTH ?? "aioa-test";
const ADMIN = process.env.ADMIN ?? "test-admin";
const MB = 1024 * 1024;
let n = 0;
const ok = (c, m) => {
  if (!c) {
    console.error("✗ " + m);
    process.exit(1);
  }
  n++;
  console.log("✓ " + m);
};
const H = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
async function api(method, path, body) {
  const r = await fetch(A + path, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const abs = (u) => (u.startsWith("http") ? u : A + u);
const sha = (b) => createHash("sha256").update(b).digest("hex");
const driveTree = async () => (await (await fetch(`${D}/api/v1/admin/stats`, { headers: { authorization: `Bearer ${ADMIN}` } })).json()).blobs;

async function upload(name, buf) {
  const c = await api("POST", "/api/v1/files", { name, size: buf.length, mime: "application/octet-stream" });
  if (c.status !== 200) return c;
  const put = await fetch(abs(c.body.upload), { method: "PUT", body: buf, headers: { "content-type": "application/octet-stream" } });
  return { ...c, put: put.status, putBody: await put.json().catch(() => ({})) };
}

// 1. 默认路由: 与接入前一样全走 R2
let u = await api("GET", "/api/v1/files");
ok(u.status === 200 && u.body.ready.cfd === true && u.body.storage.large === "r2", `用量带后端状态与默认路由 ${JSON.stringify(u.body.storage)}`);

// 2. 设置校验
let p = await api("PATCH", "/api/v1/settings", { storage: { threshold: 10 } });
ok(p.status === 400, `非法阈值被拒: ${p.body.error}`);
p = await api("PATCH", "/api/v1/settings", { storage: { large: "cfd", threshold: MB } });
ok(p.status === 200 && p.body.settings.storage.large === "cfd" && p.body.settings.storage.small === "r2", "主人把 1 MB 以上改走 Drive, 其余键补默认值");

// 3. 小文件仍走 R2
const small = randomBytes(1000);
let r = await upload("small.bin", small);
ok(r.status === 200 && !r.body.upload.includes("b=cfd") && r.put === 200, "小文件走 R2");
let l = await api("GET", `/api/v1/files/${r.body.file.id}/link`);
let got = Buffer.from(await (await fetch(abs(l.body.url))).arrayBuffer());
ok(sha(got) === sha(small), "R2 文件下载一致");

// 4. 大文件走 Drive
const before = await driveTree();
const big = randomBytes(3 * MB + 17);
r = await upload("大文件.bin", big);
ok(r.status === 200 && r.body.upload.includes("b=cfd") && r.put === 200 && r.putBody.size === big.length, `大文件登记到 Drive 并上传 ${JSON.stringify(r.putBody)}`);
const bigId = r.body.file.id;
const after = await driveTree();
ok(after.n === before.n + 1 && after.bytes - before.bytes === big.length, `Drive 多了一个 blob ${JSON.stringify(after)}`);
l = await api("GET", `/api/v1/files/${bigId}/link`);
ok(l.status === 200 && l.body.url.startsWith(D + "/") && l.body.url.includes("t="), `换到 Drive 直链 (绑定令牌) ${l.body.url.slice(0, 60)}`);
const l2 = await api("GET", `/api/v1/files/${bigId}/link`);
ok(l2.body.url === l.body.url, "直链在缓存期内不重复向 Drive 要");
const res = await fetch(l.body.url);
got = Buffer.from(await res.arrayBuffer());
ok(res.status === 200 && sha(got) === sha(big), "从 Drive 直链下载一致");
const ranged = await fetch(l.body.url, { headers: { range: `bytes=${MB}-${MB + 9}` } });
ok(ranged.status === 206 && Buffer.compare(Buffer.from(await ranged.arrayBuffer()), big.subarray(MB, MB + 10)) === 0, "Drive 直链支持 Range");

u = await api("GET", "/api/v1/files");
ok(u.body.byStore.cfd.count === 1 && u.body.byStore.cfd.bytes === big.length && u.body.byStore.r2.count === 1, `分后端用量 ${JSON.stringify(u.body.byStore)}`);

// 5. 改路由不影响已有文件
p = await api("PATCH", "/api/v1/settings", { storage: { large: "r2" } });
l = await api("GET", `/api/v1/files/${bigId}/link`);
ok(p.status === 200 && l.status === 200 && l.body.url.startsWith(D + "/"), "路由改回 R2 后, 老文件仍按自己的后端换地址");

// 6. 删除: Drive 当场彻底删
const del = await api("DELETE", `/api/v1/files/${bigId}`);
const gone = await driveTree();
ok(del.status === 200 && gone.n === before.n && gone.bytes === before.bytes, `删除后 Drive blob 当场清掉 ${JSON.stringify(gone)}`);
ok((await fetch(l.body.url)).status !== 200, "删除后旧直链失效");
ok((await api("GET", `/api/v1/files/${bigId}/link`)).status === 404, "删除后换地址 404");

// 7. 超阈值关闭
await api("PATCH", "/api/v1/settings", { storage: { large: "off" } });
r = await api("POST", "/api/v1/files", { name: "x.bin", size: 2 * MB });
ok(r.status === 413, `large=off 时拒收: ${r.body.error}`);
await api("PATCH", "/api/v1/settings", { storage: null });

console.log(`\n全部通过: ${n} 项`);
