import { DRIVE_LINK_TTL_SEC, type DriveNode, type DriveShare, isDriveId, isDriveName, normalizeDrivePath } from "@hx-aioa/protocol";
import { sha256 } from "../auth";
import { etagged, json, readJson } from "../http";
import type { DriveFs } from "./client";
import { DriveFail, relay, toRel } from "./relay";

type Body = Record<string, unknown>;
export type Op = (fs: DriveFs, req: Request, url: URL) => Promise<Response>;

const SEARCH_MAX = 100;
const Q_MAX = 100;
const TICKET_MAX = 8192;
const RECEIPTS_MAX = 6000;
const SHARE_ID_RE = /^[A-Za-z0-9_-]{4,32}$/;
// 分享有效期上限 10 年, 0 / 不给为永久
const SHARE_TTL_MAX = 10 * 365 * 86400;
const PASSWORD_MAX = 64;
const HTTP_URL = /^https?:\/\//;

const bad = (msg: string): never => {
  throw new DriveFail(400, msg);
};
const pathArg = (v: unknown): string => normalizeDrivePath(v) ?? bad("路径不合法");
const idArg = (v: unknown): string => (isDriveId(v) ? v : bad("id 不合法"));
const nameArg = (v: unknown): string => (isDriveName(v) ? v : bad("名字不合法"));

async function body(req: Request): Promise<Body> {
  const b = await readJson(req);
  return b && typeof b === "object" && !Array.isArray(b) ? (b as Body) : bad("请求体应为 JSON 对象");
}

const list: Op = async (fs, req, url) => {
  const path = pathArg(url.searchParams.get("path") ?? "/");
  const res = await fs.fetch("GET", `/fs/list?path=${encodeURIComponent(path)}`);
  if (!res.ok) return relay(res);
  const r = await res.json<{ node: DriveNode; children: DriveNode[] }>();
  if (r.node.kind !== "dir") throw new DriveFail(400, "不是文件夹");
  const out = { path, items: r.children };
  return etagged(req, (await sha256(JSON.stringify(out))).slice(0, 16), () => out);
};

const search: Op = async (fs, _req, url) => {
  const q = (url.searchParams.get("q") ?? "").trim();
  if (!q || q.length > Q_MAX) bad("搜索词应为 1 到 100 个字");
  const res = await fs.fetch("GET", `/fs/search?q=${encodeURIComponent(q)}&limit=${SEARCH_MAX}`);
  if (!res.ok) return relay(res);
  const items: (DriveNode & { path: string })[] = [];
  for (const it of (await res.json<{ items: (DriveNode & { path: string })[] }>()).items) {
    const rel = toRel(fs, it.path);
    if (rel !== null) items.push({ ...it, path: rel });
  }
  return json({ items });
};

const mkdir: Op = async (fs, req) => {
  const path = pathArg((await body(req)).path);
  if (path === "/") bad("路径不合法");
  return relay(await fs.json("POST", "/fs/mkdir", { path }));
};

const move: Op = async (fs, req) => {
  const b = await body(req);
  const id = idArg(b.id);
  const toPath = b.toPath === undefined ? undefined : pathArg(b.toPath);
  const name = b.name === undefined ? undefined : nameArg(b.name);
  if (!toPath && !name) bad("要给目标文件夹或新名字");
  return relay(await fs.json("POST", "/fs/move", { id, toPath, name }));
};

const copy: Op = async (fs, req) => {
  const b = await body(req);
  const id = idArg(b.id);
  const toPath = pathArg(b.toPath);
  const name = b.name === undefined ? undefined : nameArg(b.name);
  return relay(await fs.json("POST", "/fs/copy", { id, toPath, name }));
};

const remove: Op = async (fs, req) => {
  const id = idArg((await body(req)).id);
  return relay(await fs.json("POST", "/fs/delete", { id }));
};

const byId = (path: string): Op => async (fs, req) => relay(await fs.json("POST", path, { id: idArg((await body(req)).id) }));

const link: Op = async (fs, req) => {
  const id = idArg((await body(req)).id);
  return relay<{ url: string }>(await fs.json("POST", "/fs/link", { id, expiresIn: DRIVE_LINK_TTL_SEC }), (r) => ({ url: r.url, expires: Date.now() + DRIVE_LINK_TTL_SEC * 1000 }));
};

const manifest: Op = async (fs, _req, url) => relay(await fs.fetch("GET", `/fs/manifest?id=${encodeURIComponent(idArg(url.searchParams.get("id")))}`));

const uploads: Op = async (fs, req) => {
  const b = await body(req);
  const path = pathArg(b.path);
  const name = nameArg(b.name);
  const size = typeof b.size === "number" && Number.isSafeInteger(b.size) && b.size >= 0 ? b.size : bad("大小不合法");
  const mime = typeof b.mime === "string" && /^[\w.+-]+\/[\w.+-]+$/.test(b.mime) ? b.mime : undefined;
  const sha = typeof b.sha256 === "string" && /^[0-9a-f]{64}$/i.test(b.sha256) ? b.sha256.toLowerCase() : undefined;
  // Drive v0.4 起给公网分片地址 chunkUrl: 改名成 direct 交给 App 直传; 旧版没有, App 退回 /drive/chunk 转发 (#157)
  return relay<Record<string, unknown>>(await fs.json("POST", "/uploads", { path, name, size, mime, sha256: sha }), ({ chunkUrl, ...r }) =>
    typeof chunkUrl === "string" && HTTP_URL.test(chunkUrl) ? { ...r, direct: chunkUrl } : r,
  );
};

const ticketOf = (v: unknown): string => (typeof v === "string" && v.length > 0 && v.length <= TICKET_MAX ? v : bad("票据不合法"));
const strings = (v: unknown): string[] =>
  v === undefined ? [] : Array.isArray(v) && v.length <= RECEIPTS_MAX && v.every((x) => typeof x === "string" && x.length <= TICKET_MAX) ? (v as string[]) : bad("回执不合法");

const chunk: Op = async (fs, req, url) => {
  const ticket = ticketOf(url.searchParams.get("ticket"));
  const i = Number(url.searchParams.get("i"));
  const len = Number(req.headers.get("content-length"));
  if (!Number.isInteger(i) || i < 0) bad("需要片序号 i");
  if (!req.body || !Number.isFinite(len) || len <= 0) throw new DriveFail(411, "需要 Content-Length");
  // 转发的流没有长度, Drive 要 Content-Length: 定长流让 fetch 带上它
  const fixed = new FixedLengthStream(len);
  void req.body.pipeTo(fixed.writable).catch(() => undefined);
  const q = new URLSearchParams({ ticket, i: String(i) });
  return relay(await fs.fetch("PUT", `/uploads/chunk?${q}`, fixed.readable, { "content-length": String(len) }));
};

const fold: Op = async (fs, req) => {
  const b = await body(req);
  return relay(await fs.json("POST", "/uploads/fold", { ticket: ticketOf(b.ticket), receipts: strings(b.receipts) }));
};

const commit: Op = async (fs, req) => {
  const b = await body(req);
  return relay(await fs.json("POST", "/uploads/commit", { ticket: ticketOf(b.ticket), receipts: strings(b.receipts), folds: strings(b.folds) }));
};

type ShareRow = { id: string; node_id: string; expires_at: number | null; created_at: number; name: string; has_password: number | boolean };

const shares: Op = async (fs) =>
  relay<{ items: ShareRow[] }>(await fs.fetch("GET", "/shares"), (r) => ({
    items: r.items.map((s): DriveShare => ({
      id: s.id, nodeId: s.node_id, name: s.name, url: `${fs.origin}/s/${s.id}`, expiresAt: s.expires_at, createdAt: s.created_at, hasPassword: !!s.has_password,
    })),
  }));

const share: Op = async (fs, req) => {
  const b = await body(req);
  const id = idArg(b.id);
  const ttl = b.expiresIn === undefined || b.expiresIn === 0 ? undefined : typeof b.expiresIn === "number" && Number.isInteger(b.expiresIn) && b.expiresIn > 0 && b.expiresIn <= SHARE_TTL_MAX ? b.expiresIn : bad("有效期不合法");
  const password = b.password === undefined || b.password === "" ? undefined : typeof b.password === "string" && b.password.length <= PASSWORD_MAX ? b.password : bad("密码最长 64 位");
  return relay(await fs.json("POST", "/shares", { id, expiresIn: ttl, password }));
};

export const unshare = async (fs: DriveFs, id: string): Promise<Response> => {
  if (!SHARE_ID_RE.test(id)) bad("分享 id 不合法");
  return relay(await fs.fetch("DELETE", `/shares/${encodeURIComponent(id)}`));
};

type Stats = { nodes: { kind: string; n: number }[]; blobs: { n: number; bytes: number } };

const stats: Op = async (fs) => {
  const res = await fs.fetch("GET", "/admin/stats");
  // 令牌没有 stats 权限: 用量不显示, 不算错
  if (res.status === 403) return json({ stats: null });
  return relay<Stats>(res, (s) => ({
    stats: { files: s.nodes.find((x) => x.kind === "file")?.n ?? 0, dirs: s.nodes.find((x) => x.kind === "dir")?.n ?? 0, bytes: s.blobs.bytes },
  }));
};

/** "方法 子路径" → 处理函数; /shares/{id} 的删除单独处理。 */
export const OPS: Record<string, Op> = {
  "GET /list": list,
  "GET /search": search,
  "POST /mkdir": mkdir,
  "POST /move": move,
  "POST /copy": copy,
  "POST /delete": remove,
  "GET /trash": async (fs) => relay(await fs.fetch("GET", "/fs/trash")),
  "POST /restore": byId("/fs/restore"),
  "POST /purge": byId("/fs/purge"),
  "POST /trash/empty": async (fs) => relay(await fs.fetch("POST", "/fs/trash/empty")),
  "POST /link": link,
  "GET /manifest": manifest,
  "POST /uploads": uploads,
  "PUT /chunk": chunk,
  "POST /fold": fold,
  "POST /commit": commit,
  "GET /shares": shares,
  "POST /shares": share,
  "GET /stats": stats,
};
