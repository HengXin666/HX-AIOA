import { PATH_FILE_CHUNK, PATH_FILE_DATA } from "@hx-aioa/protocol";
import { HUB_NAME } from "../constants";
import type { Env } from "../env";
import { json } from "../http";
import { Drive, DriveError } from "./drive";
import { driveName } from "./store";
import { checkChunk, checkTicket } from "./ticket";

const DATA_RE = new RegExp(`^${PATH_FILE_DATA.replace("{id}", "([^/]+)")}$`);
const CHUNK_RE = new RegExp(`^${PATH_FILE_CHUNK.replace("{id}", "([^/]+)")}$`);
const QUERY_NAME = "n";
// 内容不会变 (同一 id 只写一次), 客户端与浏览器可以放心缓存到票据过期
const CACHE = "private, max-age=86400, immutable";
// 上传时的 Content-Type 由客户端给, 只收合法的 type/subtype
const MIME_RE = /^[\w.+-]+\/[\w.+-]+(;\s*charset=[\w.-]+)?$/i;
// 文件和 API 同源: 上传的 html / svg 在沙箱里打开, 脚本不执行, 碰不到本站; 图片音视频照常内联
const CSP = "sandbox; default-src 'none'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'unsafe-inline'";

const err = (status: number, error: string) => json({ error }, status);

/** 字节读写只经过 Worker, 不唤醒 DO (上传完成时回报一次); 不是这个路径返回 null。 */
export async function fileData(req: Request, env: Env, url: URL): Promise<Response | null> {
  const ck = CHUNK_RE.exec(url.pathname);
  if (ck) return req.method === "PUT" ? chunk(req, env, url, decodeURIComponent(ck[1] ?? "")) : err(405, "只支持 PUT");
  const m = DATA_RE.exec(url.pathname);
  if (!m) return null;
  const id = decodeURIComponent(m[1] ?? "");
  if (req.method === "PUT") return upload(req, env, url, id);
  if (!env.FILES) return err(503, "服务端还没绑定 R2 文件桶");
  if (req.method === "GET" || req.method === "HEAD") return download(req, env, url, id);
  return err(405, "只支持 PUT / GET");
}

async function upload(req: Request, env: Env, url: URL, id: string): Promise<Response> {
  const t = await checkTicket(env, "up", id, url);
  if (t === null) return err(403, "上传地址无效或已过期");
  const len = Number(req.headers.get("content-length"));
  if (!req.body || !Number.isFinite(len) || len <= 0) return err(411, "需要 Content-Length");
  if (len > t.size) return err(413, "比登记的大小大");
  const raw = req.headers.get("content-type")?.trim();
  const type = raw && raw.length <= 100 && MIME_RE.test(raw) ? raw.toLowerCase() : undefined;
  if (t.store === "cfd") return toDrive(req.body, env, url, id, len, type);
  if (!env.FILES) return err(503, "服务端还没绑定 R2 文件桶");
  const obj = await (env.FILES as R2Bucket).put(id, req.body, type ? { httpMetadata: { contentType: type } } : {});
  const hub = env.HUB.get(env.HUB.idFromName(HUB_NAME));
  if (!(await hub.fileDone(id, obj.size))) {
    await (env.FILES as R2Bucket).delete(id);
    return err(410, "文件已被删除");
  }
  return json({ ok: true, size: obj.size });
}

function driveErr(e: DriveError): Response {
  const res = json({ error: e.message }, e.status === 429 || e.status === 503 || e.status === 400 ? e.status : 502);
  if (e.retryAfter) res.headers.set("retry-after", e.retryAfter);
  return res;
}

/** 分片上传的一片: 票据里带着 Drive 的上传票据, 原样转给 Drive, 回执交给客户端自己存; 不唤醒 DO。 */
async function chunk(req: Request, env: Env, url: URL, id: string): Promise<Response> {
  // 提前拒绝时先丢掉请求体, 否则连接会被重置, 客户端复用这条连接的下一个请求跟着失败
  const reject = (status: number, msg: string) => {
    void req.body?.cancel().catch(() => undefined);
    return err(status, msg);
  };
  const ticket = await checkChunk(env, id, url);
  if (ticket === null) return reject(403, "上传地址无效或已过期");
  const i = Number(url.searchParams.get("i"));
  const len = Number(req.headers.get("content-length"));
  if (!Number.isInteger(i) || i < 0) return reject(400, "需要片序号 i");
  if (!req.body || !Number.isFinite(len) || len <= 0) return reject(411, "需要 Content-Length");
  const drive = Drive.from(env);
  if (!drive) return reject(503, "服务端还没接入 HX-CF-Drive");
  try {
    return json({ receipt: await drive.chunk(ticket, i, len, req.body) });
  } catch (e) {
    if (e instanceof DriveError) return driveErr(e);
    throw e;
  }
}

/** 登记到 Drive 的文件: 字节流式转给 Drive, 回报 Drive 节点 id; Drive 限流 / 忙时把状态码和 Retry-After 原样给客户端。 */
async function toDrive(body: ReadableStream, env: Env, url: URL, id: string, len: number, type: string | undefined): Promise<Response> {
  const drive = Drive.from(env);
  if (!drive) return err(503, "服务端还没接入 HX-CF-Drive");
  let node: { id: string; size: number };
  try {
    node = await drive.upload(await drive.dir(), driveName(id, url.searchParams.get(QUERY_NAME) ?? "file"), len, type ?? "application/octet-stream", body);
  } catch (e) {
    if (!(e instanceof DriveError)) throw e;
    return driveErr(e);
  }
  const hub = env.HUB.get(env.HUB.idFromName(HUB_NAME));
  if (!(await hub.fileDone(id, node.size, node.id))) {
    await drive.remove(node.id);
    return err(410, "文件已被删除");
  }
  return json({ ok: true, size: node.size });
}

async function download(req: Request, env: Env, url: URL, id: string): Promise<Response> {
  if ((await checkTicket(env, "dl", id, url)) === null) return err(403, "下载地址无效或已过期");
  const obj = await (env.FILES as R2Bucket).get(id, { range: req.headers, onlyIf: req.headers });
  if (!obj) return err(404, "文件不存在或已删除");
  const h = new Headers();
  obj.writeHttpMetadata(h);
  h.set("etag", obj.httpEtag);
  h.set("cache-control", CACHE);
  h.set("accept-ranges", "bytes");
  h.set("x-content-type-options", "nosniff");
  if (!h.get("content-type")?.startsWith("application/pdf")) h.set("content-security-policy", CSP);
  const name = url.searchParams.get(QUERY_NAME);
  if (name) h.set("content-disposition", `inline; filename*=UTF-8''${encodeURIComponent(name)}`);
  if (!("body" in obj)) return new Response(null, { status: 304, headers: h });
  const r = (obj as R2ObjectBody).range as { offset?: number; length?: number } | undefined;
  if (r && req.headers.has("range")) {
    const start = r.offset ?? 0;
    const length = r.length ?? obj.size - start;
    h.set("content-range", `bytes ${start}-${start + length - 1}/${obj.size}`);
    return new Response(req.method === "HEAD" ? null : (obj as R2ObjectBody).body, { status: 206, headers: h });
  }
  return new Response(req.method === "HEAD" ? null : (obj as R2ObjectBody).body, { headers: h });
}
