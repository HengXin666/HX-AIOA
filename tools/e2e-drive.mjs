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
// 长时间空闲后 wrangler dev 会关掉 keep-alive 连接, Node 复用旧连接时偶尔 ECONNRESET; 这只是测试客户端的问题, 重试一次
async function driveTree() {
  const get = () => fetch(`${D}/api/v1/admin/stats`, { headers: { authorization: `Bearer ${ADMIN}` } });
  const r = await get().catch((e) => (e?.cause?.code === "ECONNRESET" ? get() : Promise.reject(e)));
  return (await r.json()).blobs;
}

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

// 8. 超过 95 MB: 分片传到 Drive (路由必须是 large=cfd), R2 路由拒收
await api("PATCH", "/api/v1/settings", { storage: { large: "r2", threshold: 20 * MB } });
r = await api("POST", "/api/v1/files", { name: "huge.bin", size: 96 * MB });
ok(r.status === 413, `大文件走 R2 时超过 95 MB 拒收: ${r.body.error}`);
await api("PATCH", "/api/v1/settings", { storage: { large: "cfd" } });
const huge = randomBytes(96 * MB + 5);
const c = await api("POST", "/api/v1/files", { name: "huge.bin", size: huge.length, mime: "application/octet-stream" });
ok(c.status === 200 && c.body.chunks?.count >= 2, `登记返回分片 ${JSON.stringify(c.body.chunks)}`);
const receipts = [];
for (let i = 0; i < c.body.chunks.count; i++) {
  const part = huge.subarray(i * c.body.chunks.size, Math.min(huge.length, (i + 1) * c.body.chunks.size));
  const pr = await fetch(abs(`${c.body.upload}&i=${i}`), { method: "PUT", body: part });
  const pj = await pr.json();
  if (pr.status !== 200) ok(false, `第 ${i} 片 ${pr.status} ${JSON.stringify(pj)}`);
  receipts.push(pj.receipt);
}
ok(receipts.length === c.body.chunks.count, `${receipts.length} 片都拿到回执`);
const bad = await fetch(abs(c.body.upload.replace(/([?&]d=)[^&]+/, "$1x") + "&i=0"), { method: "PUT", body: huge.subarray(0, 10) });
ok(bad.status === 403, "改了票据里的 Drive 票据无效");
const before2 = await api("GET", `/api/v1/files/${c.body.file.id}/link`);
ok(before2.status === 404, "提交前换不了地址");
const cm = await api("POST", `/api/v1/files/${c.body.file.id}/commit`, { receipts });
ok(cm.status === 200 && cm.body.file.size === huge.length, `提交完成 ${JSON.stringify(cm.body.file)}`);
const again = await api("POST", `/api/v1/files/${c.body.file.id}/commit`, { receipts });
ok(again.status === 404, "重复提交被拒");
l = await api("GET", `/api/v1/files/${c.body.file.id}/link`);
let have = Buffer.alloc(0);
while (have.length < huge.length) {
  const rr = await fetch(l.body.url, { headers: have.length ? { range: `bytes=${have.length}-` } : {} });
  have = Buffer.concat([have, Buffer.from(await rr.arrayBuffer())]);
}
ok(sha(have) === sha(huge), "分片文件下载一致");
ok((await api("DELETE", `/api/v1/files/${c.body.file.id}`)).status === 200 && (await driveTree()).n === 0, "分片文件删除后 Drive 清空");

// 9. 迁移任务: R2 → Drive → R2, 文件 id 不变
await api("PATCH", "/api/v1/settings", { storage: { large: "r2", threshold: 20 * MB } });
const mv = randomBytes(2 * MB + 3);
r = await upload("move.bin", mv);
const mvId = r.body.file.id;
const oldUrl = (await api("GET", `/api/v1/files/${mvId}/link`)).body.url;
async function runJob(to) {
  const st = await api("POST", "/api/v1/files/migrate", { to });
  if (st.status !== 200) return st;
  for (let i = 0; i < 30; i++) {
    const j = await api("GET", "/api/v1/files/migrate");
    if (j.body.job?.finished) return j;
    await new Promise((res) => setTimeout(res, 1000));
  }
  return { status: 0, body: {} };
}
let job = await runJob("cfd");
ok(job.status === 200 && job.body.job.moved >= 1 && job.body.job.failed === 0 && job.body.job.left === 0, `迁到 Drive ${JSON.stringify(job.body.job)}`);
l = await api("GET", `/api/v1/files/${mvId}/link`);
ok(l.body.url.startsWith(D + "/") && sha(Buffer.from(await (await fetch(l.body.url)).arrayBuffer())) === sha(mv), "迁移后同一个 id 换到 Drive 地址, 内容一致");
ok([403, 404, 410].includes((await fetch(abs(oldUrl))).status), "迁移前的 R2 地址失效 (客户端换一次地址)");
ok((await api("POST", "/api/v1/files/migrate", { to: "s3" })).status === 400, "目标后端校验");
job = await runJob("r2");
ok(job.status === 200 && job.body.job.moved >= 1 && job.body.job.failed === 0, `迁回 R2 ${JSON.stringify(job.body.job)}`);
l = await api("GET", `/api/v1/files/${mvId}/link`);
ok(!l.body.url.startsWith(D + "/") && sha(Buffer.from(await (await fetch(abs(l.body.url))).arrayBuffer())) === sha(mv), "迁回后换到 R2 地址, 内容一致");
ok((await driveTree()).n === 0, "迁回后 Drive 里的旧副本已删");
await api("PATCH", "/api/v1/settings", { storage: null });

console.log(`\n全部通过: ${n} 项`);
