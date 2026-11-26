// 多市场源 e2e: 加源, 合并列表, 跳过冒用官方命名空间的条目, 缓存不重复请求, 第三方不能带服务端代码, 删源
// 环境变量: AIOA_SERVER, AIOA_TOKEN; 官方市场 (wrangler 的 PLUGIN_MARKET, 127.0.0.1:8797) 与第三方市场 (8798) 都由本脚本起
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const server = process.env.AIOA_SERVER;
const token = process.env.AIOA_TOKEN;
if (!server || !token) {
  console.error("需要环境变量 AIOA_SERVER 和 AIOA_TOKEN");
  process.exit(1);
}
const V1 = "/api/v1";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "plugins");
const THIRD = "e2etest.notes";
const SRV = "e2etest.srv";
let failed = 0;
const hits = [];

const base = { version: "1.0.0", api: "2", engines: { aioa: "^2" }, readme: "README.md", prompt: "prompt.md", group: { title: "笔记" }, permissions: ["data:own"] };
const notes = { ...base, id: THIRD, name: "e2e 笔记", summary: "第三方源的插件", agent: { name: "记录员", task: "整理笔记" } };
const srv = { ...base, id: SRV, name: "e2e 服务端", summary: "带服务端代码", server: true };
const fake = { ...base, id: "hengxin666.fake", name: "冒名", summary: "冒用官方命名空间" };
const third = {
  name: "e2e 第三方",
  // 第三方的内嵌清单故意和 plugin.json 不同: 服务端应以 plugin.json 为准
  plugins: [notes, srv, fake].map((m) => ({ id: m.id, name: m.name, summary: m.summary, version: m.version, icon: "puzzle", author: "e2e", manifest: { ...m, summary: "内嵌的假介绍" } })),
};
const files = { "README.md": "# e2e 笔记\n", "prompt.md": "按 {{channel}} 整理。\n" };

function serve(port, handler) {
  const s = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(req.url ?? "/")).replace(/^(\.\.[/\\])+/, "");
    const text = await handler(path).catch(() => null);
    res.writeHead(text === null ? 404 : 200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(text ?? "not found");
  });
  return new Promise((r) => s.listen(port, "127.0.0.1", () => r(s)));
}

const official = await serve(8797, (p) => readFile(join(ROOT, p), "utf8"));
const market = await serve(8798, async (p) => {
  hits.push(p);
  if (p === "/m/index.json" || p === "/m2/index.json") return JSON.stringify({ ...third, name: p.startsWith("/m2") ? "e2e 第二源" : third.name });
  const [, , id, name] = p.split("/");
  if ([THIRD, SRV].includes(id) && files[name]) return files[name];
  if (id === THIRD && name === "plugin.json") return JSON.stringify(notes);
  if (id === SRV && name === "plugin.json") return JSON.stringify(srv);
  return null;
});

function check(name, ok, detail = "") {
  console.log(`${ok ? "通过" : "失败"} ${name}${ok ? "" : ` ${JSON.stringify(detail).slice(0, 400)}`}`);
  if (!ok) failed += 1;
}

async function api(method, path, body) {
  const res = await fetch(server + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {}
  return { status: res.status, data, text };
}

const SOURCES = `${V1}/plugin-sources`;
const first = await api("GET", SOURCES);
check("默认只有官方源", first.status === 200 && first.data.sources.length >= 1 && first.data.sources[0].official, first.data);
check("拒绝 http 外部链接", (await api("POST", SOURCES, { link: "http://example.com/m" })).status === 400);
const added = await api("POST", SOURCES, { link: "http://127.0.0.1:8798/m" });
check("加第三方源", added.status === 201 && added.data.name === "e2e 第三方" && added.data.count === 2, added.data);
check("重复加同一个源被拒", (await api("POST", SOURCES, { link: "http://127.0.0.1:8798/m/" })).status === 409);

const list = await api("GET", `${V1}/plugins`);
const row = list.data?.plugins?.find((p) => p.id === THIRD);
check("列表合并第三方插件并标来源", row?.source === added.data.id && row.manifest === undefined, row);
check("冒用官方命名空间的被跳过", !list.data.plugins.some((p) => p.id === "hengxin666.fake"), list.data.plugins.map((p) => p.id));
const srcs = await api("GET", SOURCES);
const me = srcs.data.sources.find((s) => s.id === added.data.id);
check("源上记下跳过原因", me?.skipped?.some((x) => x.startsWith("hengxin666.fake")), me);

const d1 = await api("GET", `${V1}/plugins/${THIRD}`);
check("详情带来源与介绍", d1.status === 200 && d1.data.source === "e2e 第三方" && d1.data.readme.includes("e2e 笔记"), d1.data);
check("第三方以 plugin.json 为准, 不信内嵌清单", d1.data.manifest.summary === notes.summary, d1.data.manifest.summary);
const before = hits.length;
await api("GET", `${V1}/plugins`);
await api("GET", `${V1}/plugins/${THIRD}`);
// 管理员看详情会重拉一次索引 (看最新版本), 介绍和提示词按版本缓存不再拉
const extra = hits.slice(before);
check("再看列表与详情只重拉索引", extra.every((p) => p === "/m/index.json") && extra.length <= 1, extra);

check("第三方插件不带摘要不能放行", (await api("PUT", `${V1}/plugin-allow/${THIRD}`, {})).status === 409);
// 同版本偷换提示词: 刷新清掉文件缓存后, 旧摘要放行被拒
files["prompt.md"] = "偷换的提示词 {{channel}}\n";
await api("POST", `${V1}/plugin-sources-refresh`, {});
const swapped = await api("PUT", `${V1}/plugin-allow/${THIRD}`, { digest: d1.data.digest });
check("同版本内容变了, 旧摘要放行被拒", swapped.status === 409, swapped.text);
const d2 = await api("GET", `${V1}/plugins/${THIRD}`);
const allow = await api("PUT", `${V1}/plugin-allow/${THIRD}`, { digest: d2.data.digest });
check("带详情给的摘要放行第三方插件", d2.data.digest !== d1.data.digest && allow.status === 200 && allow.data.allow?.source === added.data.id, allow.data);
const bad = await api("PUT", `${V1}/plugin-allow/${SRV}`, {});
check("第三方源不能带服务端代码", bad.status === 400 && /官方源/.test(bad.text), bad.text);

const del = await api("DELETE", `${SOURCES}/${added.data.id}`);
check("删源", del.status === 200);
const after = await api("GET", `${V1}/plugins`);
const kept = after.data.plugins.find((p) => p.id === THIRD);
check("删源后已放行的仍在列表里", kept?.allowed?.version === "1.0.0" && !after.data.error, kept);
const snap = await api("GET", `${V1}/plugins/${THIRD}`);
check("删源后详情用放行时的快照", snap.status === 200 && snap.data.gone === true && snap.data.manifest.id === THIRD, snap.data);
// 另一个源发了同 id: 换源不能当更新放行
const other = await api("POST", SOURCES, { link: "http://127.0.0.1:8798/m2" });
const moved = await api("GET", `${V1}/plugins/${THIRD}`);
check("换源后详情显示放行时的快照", other.status === 201 && moved.data.gone === true, moved.data);
const fresh = await api("GET", `${V1}/plugins`);
check("换源后列表仍标已放行", fresh.data.plugins.find((p) => p.id === THIRD)?.allowed?.version === "1.0.0");
const d3 = await api("PUT", `${V1}/plugin-allow/${THIRD}`, { digest: d2.data.digest });
check("换源放行被拒", d3.status === 409 && /另一个市场源/.test(d3.text), d3.text);
await api("DELETE", `${SOURCES}/${other.data.id}`);
check("删源后能撤销放行", (await api("DELETE", `${V1}/plugin-allow/${THIRD}`)).status === 200);
const gone = await api("GET", `${V1}/plugins`);
check("撤销后列表不再有它", !gone.data.plugins.some((p) => p.id === THIRD), gone.data.plugins.map((p) => p.id));

official.close();
market.close();
console.log(failed ? `\n${failed} 项失败` : "\n全部通过");
process.exit(failed ? 1 : 0);
