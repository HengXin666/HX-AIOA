import {
  DRIVE_NEED_UPLOAD,
  DRIVE_PART_SIZE,
  DRIVE_SAVE_DIR,
  HEADER_DRIVE_PASS,
  PATH_DRIVE,
  PATH_DRIVE_ATTACH,
  PATH_DRIVE_PASS,
  PATH_DRIVE_SAVE,
  type DriveAttachResult,
  type DriveList,
  type DriveNode,
  type DrivePass,
  type DriveSearchItem,
  type DriveShare,
  type DriveStats,
  type DriveTrashItem,
  type DriveUploadInit,
  type FileRef,
} from "@hx-aioa/protocol";
import { api, ApiError } from "./auth";
import { Emitter } from "./emitter";
import { fileUrl } from "./files";

// 网盘 (对照安卓 ui/drive/DriveApi.kt, docs/features/drive.md): 先到 Hub 换 1 小时通行证, 之后的请求由 Worker 验证后转给 Drive, 不进 DO
const PASS_EARLY_MS = 60_000;
const HTTP_NOT_MODIFIED = 304;
let pass: DrivePass | null = null;
let passing: Promise<DrivePass> | null = null;

async function passOf(): Promise<string> {
  if (pass && pass.expires - Date.now() > PASS_EARLY_MS) return pass.pass;
  passing ??= api<DrivePass>(PATH_DRIVE_PASS, { method: "POST" }).finally(() => (passing = null));
  pass = await passing;
  return pass.pass;
}

async function call(method: string, sub: string, opts: { query?: Record<string, string>; body?: unknown; raw?: BodyInit; headers?: Record<string, string> } = {}): Promise<Response> {
  const q = opts.query ? `?${new URLSearchParams(opts.query)}` : "";
  const headers: Record<string, string> = { [HEADER_DRIVE_PASS]: await passOf(), ...opts.headers };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${PATH_DRIVE}/${sub}${q}`, { method, headers, body: opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)) }).catch(() => {
    throw new ApiError(0, "连不上网盘");
  });
  if (res.status === 401) pass = null;
  if (!res.ok && res.status !== HTTP_NOT_MODIFIED) {
    const b = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new ApiError(res.status, b.error ?? `网盘请求失败 (${res.status})`, b.code);
  }
  return res;
}

const json = async <T>(method: string, sub: string, body?: unknown, query?: Record<string, string>): Promise<T> => (await call(method, sub, { body, query })).json() as Promise<T>;

// 目录列表按路径缓存 (内存), 带 ETag, 没变回 304
type Listing = DriveList & { stats?: DriveStats; etag?: string };
const lists = new Map<string, Listing>();
export const driveChanged = new Emitter<string>();

export function cachedList(path: string): Listing | undefined {
  return lists.get(path);
}

export async function list(path: string, fresh = false): Promise<Listing> {
  const old = lists.get(path);
  const query: Record<string, string> = { path };
  if (fresh) query.fresh = "1";
  if (path === "/") query.stats = "1";
  const res = await call("GET", "list", { query, headers: old?.etag && !fresh ? { "if-none-match": old.etag } : {} });
  if (res.status === HTTP_NOT_MODIFIED && old) return old;
  const next = { ...((await res.json()) as Listing), etag: res.headers.get("etag") ?? undefined };
  lists.set(path, next);
  return next;
}

// 写操作后整体作废本地列表 (服务端也换了版本号), 再通知页面重拉
function touched(): void {
  lists.clear();
  driveChanged.emit("");
}
async function write<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } finally {
    touched();
  }
}

export const search = async (q: string) => (await json<{ items: DriveSearchItem[] }>("GET", "search", undefined, { q })).items;
export const mkdir = (path: string) => write(() => json("POST", "mkdir", { path }));
export const rename = (id: string, name: string) => write(() => json("POST", "move", { id, name }));
export const move = (id: string, toPath: string) => write(() => json("POST", "move", { id, toPath }));
export const copy = (id: string, toPath: string) => write(() => json("POST", "copy", { id, toPath }));
export const remove = (id: string) => write(() => json("POST", "delete", { id }));
export const trash = async () => (await json<{ items: DriveTrashItem[] }>("GET", "trash")).items;
export const restore = (id: string) => write(() => json("POST", "restore", { id }));
export const purge = (id: string) => write(() => json("POST", "purge", { id }));
export const emptyTrash = () => write(() => json("POST", "trash/empty"));
export const linkOf = async (id: string) => (await json<{ url: string }>("POST", "link", { id })).url;
export const shares = async () => (await json<{ items: DriveShare[] }>("GET", "shares")).items;
export const share = (id: string, expiresIn?: number, password?: string) => json<{ id: string }>("POST", "shares", { id, expiresIn, password });
export const unshare = async (id: string) => void (await call("DELETE", `shares/${encodeURIComponent(id)}`));

// 网盘文件发到群: 服务端复制进附件目录登记成附件, 再按普通文件消息发
export const attach = (id: string, channel?: string) => api<DriveAttachResult>(PATH_DRIVE_ATTACH, { method: "POST", body: JSON.stringify({ id, channel }) });

export type UploadProgress = (sent: number, total: number) => void;

// 上传 (#157): 先申请, 秒传直接完成; 否则按片传, 优先直传 Drive 公网 (direct, 不带凭证), 不通时改走 Worker 转发; 超过 256 片按组 fold
export async function upload(dir: string, file: File, onProgress: UploadProgress, signal: AbortSignal): Promise<DriveNode> {
  const init = await write(() => json<DriveUploadInit>("POST", "uploads", { path: dir, name: file.name, size: file.size, mime: file.type || undefined }));
  if (init.done) return init.node;
  let direct = init.direct;
  const receipts: string[] = [];
  const folds: string[] = [];
  for (let i = 0; i < init.chunkCount; i++) {
    if (signal.aborted) throw new ApiError(0, "已取消");
    const part = file.slice(i * init.chunkSize, Math.min(file.size, (i + 1) * init.chunkSize));
    receipts.push(await putChunk(init.ticket, i, part, direct, () => (direct = undefined), signal));
    onProgress(Math.min(file.size, (i + 1) * init.chunkSize), file.size);
    if (init.chunkCount > DRIVE_PART_SIZE && receipts.length === DRIVE_PART_SIZE) {
      const f = await json<{ fold?: string }>("POST", "fold", { ticket: init.ticket, receipts }).catch(() => null);
      if (f?.fold) {
        folds.push(f.fold);
        receipts.length = 0;
      }
    }
  }
  const done = await write(() => json<{ node: DriveNode }>("POST", "commit", { ticket: init.ticket, receipts, folds }));
  return done.node;
}

async function putChunk(ticket: string, i: number, part: Blob, direct: string | undefined, dropDirect: () => void, signal: AbortSignal): Promise<string> {
  if (direct) {
    try {
      const u = new URL(direct);
      u.searchParams.set("ticket", ticket);
      u.searchParams.set("i", String(i));
      const res = await fetch(u, { method: "PUT", body: part, signal });
      if (res.ok) return ((await res.json()) as { receipt: string }).receipt;
      // 片本身的错误照常报; 地址被拦或旧版不认时改走转发
      if (res.status === 400 || res.status === 429 || res.status >= 500) throw new ApiError(res.status, `上传失败 (${res.status})`);
    } catch (e) {
      if (signal.aborted || (e instanceof ApiError && e.status)) throw e;
    }
    dropDirect();
  }
  const res = await call("PUT", "chunk", { query: { ticket, i: String(i) }, raw: part });
  return ((await res.json()) as { receipt: string }).receipt;
}

// 聊天文件存到网盘: Drive 上的附件服务端复制 (0 字节); 服务端复制不了 (409 need_upload) 时浏览器下载后再传
export async function saveFile(ref: FileRef): Promise<string> {
  try {
    const r = await write(() => api<{ path: string }>(PATH_DRIVE_SAVE, { method: "POST", body: JSON.stringify({ file: ref.id }) }));
    return r.path || DRIVE_SAVE_DIR;
  } catch (e) {
    if (!(e instanceof ApiError && e.code === DRIVE_NEED_UPLOAD)) throw e;
  }
  const url = await fileUrl(ref.id);
  const blob = url ? await (await fetch(url)).blob() : null;
  if (!blob) throw new ApiError(0, "下载附件失败");
  await mkdir(DRIVE_SAVE_DIR).catch(() => undefined);
  await upload(DRIVE_SAVE_DIR, new File([blob], ref.name, { type: ref.mime }), () => undefined, new AbortController().signal);
  return DRIVE_SAVE_DIR;
}
