#!/usr/bin/env node
// 文件冒烟测试: 登记 -> PUT 字节 (Worker 直写 R2) -> 带附件发消息 -> 换下载地址 -> 下载 / 断点 -> 引用它的消息都删掉后文件跟着删除
// 环境变量: AIOA_SERVER, AIOA_TOKEN
const server = process.env.AIOA_SERVER;
const token = process.env.AIOA_TOKEN;
if (!server || !token) {
  console.error("需要环境变量 AIOA_SERVER 和 AIOA_TOKEN");
  process.exit(1);
}
const V1 = "/api/v1";
const RUN = Date.now().toString(36);
const GROUP = `files-${RUN}`;
const NAME = "测试 报告.txt";
const MIME = "text/plain";
const PART = 5;
let failed = 0;

function check(name, ok, detail = "") {
  console.log(`${ok ? "通过" : "失败"} ${name}${ok ? "" : ` ${JSON.stringify(detail)}`}`);
  if (!ok) failed += 1;
}

async function api(method, path, body) {
  const res = await fetch(server + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

const bytes = new TextEncoder().encode(`你好, 文件 ${RUN}\n`.repeat(50));

const big = await api("POST", `${V1}/files`, { name: "x.bin", size: 200 * 1024 * 1024 });
check("超过单文件上限被拒", big.status === 413, big);
const made = await api("POST", `${V1}/files`, { name: NAME, size: bytes.length, mime: MIME, channel: GROUP });
check("登记文件", made.status === 200 && made.data.file.id.startsWith("f_") && made.data.upload.includes("/data?"), made);
const id = made.data?.file?.id;

const early = await api("POST", `${V1}/messages`, { text: "还没传完", channel: GROUP, file: id });
check("没传完不能发", early.status === 400, early);

const forged = await fetch(server + made.data.upload.replace(/t=[^&]+/, "t=bad"), { method: "PUT", body: bytes });
check("伪造票据被拒", forged.status === 403);
const larger = await fetch(server + made.data.upload, { method: "PUT", body: new Uint8Array(bytes.length + 10) });
check("比登记的大被拒", larger.status === 413);
const put = await fetch(server + made.data.upload, { method: "PUT", headers: { "Content-Type": MIME }, body: bytes });
check("上传字节", put.status === 200, await put.text());

const sent = await api("POST", `${V1}/messages`, { text: "[文件] 报告", channel: GROUP, file: id });
check("带附件发消息", sent.status === 200 && !!sent.data.id, sent.data);
const seqOf = async (evId) => (await api("GET", `${V1}/chats/${encodeURIComponent(GROUP)}/messages?since=0`)).data?.messages?.find((m) => m.id === evId);
const first = await seqOf(sent.data?.id);
check("历史里带附件", first?.data?.file?.name === NAME && first?.data?.file?.size === bytes.length, first);
const seq = first?.seq;

const link = await api("GET", `${V1}/files/${id}/link`);
check("换下载地址", link.status === 200 && link.data.url.includes("/data?"), link);
const dl = await fetch(server + link.data.url);
const got = new Uint8Array(await dl.arrayBuffer());
check("下载内容一致", dl.status === 200 && got.length === bytes.length && got.every((b, i) => b === bytes[i]));
check("带文件名与缓存头", (dl.headers.get("content-disposition") ?? "").includes("filename*=UTF-8''") && (dl.headers.get("cache-control") ?? "").includes("immutable"), Object.fromEntries(dl.headers));
const part = await fetch(server + link.data.url, { headers: { Range: `bytes=0-${PART - 1}` } });
const pb = new Uint8Array(await part.arrayBuffer());
check("断点下载", part.status === 206 && pb.length === PART, part.status);
const up403 = await fetch(server + link.data.url, { method: "PUT", body: bytes });
check("下载票据不能上传", up403.status === 403);

const fwd = await api("POST", `${V1}/messages`, { text: "再发一次", channel: GROUP, file: id });
check("同一个文件被两条消息引用", fwd.status === 200);
await api("DELETE", `${V1}/events/seq/${seq}?mode=delete`);
const still = await api("GET", `${V1}/files/${id}/link`);
check("还有引用时不删", still.status === 200, still);
await api("DELETE", `${V1}/events/seq/${(await seqOf(fwd.data.id))?.seq}?mode=delete`);
const gone = await api("GET", `${V1}/files/${id}/link`);
check("最后一条删除后文件删除", gone.status === 404, gone);
const after = await fetch(server + link.data.url);
check("R2 里也删了", after.status === 404);

const usage = await api("GET", `${V1}/files`);
check("用量", usage.status === 200 && typeof usage.data.bytes === "number", usage);

const m2 = await api("POST", `${V1}/files`, { name: "b.txt", size: 3, channel: GROUP });
await fetch(server + m2.data.upload, { method: "PUT", body: "abc" });
await api("POST", `${V1}/messages`, { text: "b", channel: GROUP, file: m2.data.file.id });
await api("DELETE", `${V1}/chats/${encodeURIComponent(GROUP)}/messages`);
const cleared = await api("GET", `${V1}/files/${m2.data.file.id}/link`);
check("清空群时文件一起删", cleared.status === 404, cleared);

console.log(failed ? `${failed} 项失败` : "全部通过");
process.exit(failed ? 1 : 0);
