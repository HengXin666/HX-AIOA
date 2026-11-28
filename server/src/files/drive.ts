import { DRIVE_AIOA_DIR, DRIVE_PART_SIZE, type FileDirect } from "@hx-aioa/protocol";
import type { Env } from "../env";
import { driveDir } from "./store";

const API = "/api/v1";
const DAY_SEC = 86400;

/** Drive 返回的失败; status 与 Retry-After 原样带回给客户端。 */
export class DriveError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfter?: string,
  ) {
    super(message);
  }
}

type NodeOut = { id: string; size: number };

// 令牌根目录 (Drive 里的绝对路径) 每个 isolate 按令牌缓存 10 分钟: 主人在 Drive 后台改了根目录, 最多 10 分钟后跟上
const ROOT_TTL_MS = 10 * 60_000;
const roots = new Map<string, { path: string; at: number }>();

/** 令牌根目录在 Drive 里的绝对路径 (#157); 问不到返回 null。 */
export async function tokenRoot(fetcher: Fetcher, origin: string, token: string, now = Date.now()): Promise<string | null> {
  const key = `${origin} ${token}`;
  const hit = roots.get(key);
  if (hit && now - hit.at < ROOT_TTL_MS) return hit.path;
  const res = await fetcher.fetch(new Request(`${origin}${API}/fs/stat?path=%2F`, { headers: { authorization: `Bearer ${token}` } })).catch(() => null);
  if (!res?.ok) return null;
  const path = (await res.json<{ path?: unknown }>().catch(() => ({}) as { path?: unknown })).path;
  if (typeof path !== "string" || !path.startsWith("/")) return null;
  roots.set(key, { path, at: now });
  return path;
}

/**
 * 聊天附件的月目录, 相对令牌根 (#157): 附件一律放在 Drive 的 /aioa/YYYY-MM。
 * 根是 / (主人把 CFD_TOKEN 的根改成了整盘) 时带上 /aioa; 根是 /aioa 或问不到时按原约定 /YYYY-MM; 根在别处返回 null。
 */
export function attachDirOf(root: string | null, now = Date.now()): string | null {
  if (root === "/") return `${DRIVE_AIOA_DIR}${driveDir(now)}`;
  return root === null || root === DRIVE_AIOA_DIR ? driveDir(now) : null;
}

/**
 * HX-CF-Drive 客户端。只走 Service Binding (同账号, 不经过公网和 WAF), 令牌是 Drive 后台建的令牌 (根目录 /aioa, 或整盘 /, 见 dir)。
 * CFD_ORIGIN 是 Drive 的公网地址: 经 Binding 发的请求也用它做 URL, Drive 按请求地址生成的直链才是客户端能访问的。
 */
export class Drive {
  constructor(
    private readonly fetcher: Fetcher,
    private readonly origin: string,
    private readonly token: string,
  ) {}

  /** 三项都配了才算接入; 缺任何一项都当没接, 不退回走公网。 */
  static from(env: Env): Drive | undefined {
    const origin = env.CFD_ORIGIN?.trim().replace(/\/+$/, "");
    return env.DRIVE && env.CFD_TOKEN && origin ? new Drive(env.DRIVE, origin, env.CFD_TOKEN) : undefined;
  }

  private async call<T>(method: string, path: string, body?: BodyInit | null, headers: Record<string, string> = {}): Promise<T> {
    const res = await this.fetcher.fetch(new Request(`${this.origin}${API}${path}`, { method, body, headers: { authorization: `Bearer ${this.token}`, ...headers } }));
    if (!res.ok) {
      const msg = await res.json<{ error?: string }>().then((j) => j.error, () => undefined);
      throw new DriveError(res.status, `Drive ${res.status}: ${msg ?? res.statusText}`, res.headers.get("retry-after") ?? undefined);
    }
    return res.json<T>();
  }

  private json<T>(path: string, body: unknown): Promise<T> {
    return this.call<T>("POST", path, JSON.stringify(body), { "content-type": "application/json" });
  }

  /** 新附件放哪个目录 (相对令牌根): 根在 /aioa 与 / 之外时照旧放根下的 /YYYY-MM。 */
  async dir(now = Date.now()): Promise<string> {
    return attachDirOf(await tokenRoot(this.fetcher, this.origin, this.token, now), now) ?? driveDir(now);
  }

  /** 一次性上传 (≤ 95 MB): 字节流式转给 Drive, 不在 Worker 里缓冲。 */
  async upload(dir: string, name: string, size: number, mime: string, body: ReadableStream | string): Promise<NodeOut> {
    const q = new URLSearchParams({ path: dir, name });
    let stream: BodyInit = body;
    // 转发的流没有长度, Drive 的原始上传要 Content-Length; 定长流让 fetch 带上它
    if (typeof body !== "string") {
      const fixed = new FixedLengthStream(size);
      void body.pipeTo(fixed.writable).catch(() => undefined);
      stream = fixed.readable;
    }
    const r = await this.call<{ data: { node: NodeOut } }>("POST", `/upload?${q}`, stream, { "content-type": mime, "content-length": String(size) });
    return { id: r.data.node.id, size: r.data.node.size };
  }

  /** 分片上传第 1 步: 申请 Drive 的上传票据 (24 小时), 返回片大小与片数。 */
  async init(dir: string, name: string, size: number, mime: string): Promise<{ ticket: string; chunkSize: number; chunkCount: number }> {
    const r = await this.json<{ done?: boolean; ticket?: string; chunkSize?: number; chunkCount?: number }>("/uploads", { path: dir, name, size, mime });
    if (r.done || !r.ticket || !r.chunkSize || !r.chunkCount) throw new DriveError(502, "Drive 没有返回上传票据");
    return { ticket: r.ticket, chunkSize: r.chunkSize, chunkCount: r.chunkCount };
  }

  /** 第 2 步: 传一片, 字节流式转给 Drive, 返回 Drive 签发的回执。 */
  async chunk(ticket: string, i: number, len: number, body: ReadableStream): Promise<string> {
    const fixed = new FixedLengthStream(len);
    void body.pipeTo(fixed.writable).catch(() => undefined);
    const q = new URLSearchParams({ ticket, i: String(i) });
    return (await this.call<{ receipt: string }>("PUT", `/uploads/chunk?${q}`, fixed.readable, { "content-length": String(len) })).receipt;
  }

  /**
   * 第 3 步: 交全部回执, 返回 Drive 的文件节点。超过一组 (256 片, 约 4.75 GB) 时先每组 fold 成一个聚合回执,
   * commit 只验几个签名, 不超 Drive 的 CPU (#157)。回执按片序排好 (客户端按序交); 顺序不对 fold 会 400, 退回整体提交。
   */
  async commit(ticket: string, receipts: string[]): Promise<NodeOut> {
    const folds = receipts.length > DRIVE_PART_SIZE ? await this.foldAll(ticket, receipts) : null;
    const r = await this.json<{ node: NodeOut }>("/uploads/commit", folds ? { ticket, folds } : { ticket, receipts });
    return { id: r.node.id, size: r.node.size };
  }

  private async foldAll(ticket: string, receipts: string[]): Promise<string[] | null> {
    const out: string[] = [];
    for (let i = 0; i < receipts.length; i += DRIVE_PART_SIZE) {
      try {
        out.push((await this.json<{ fold: string }>("/uploads/fold", { ticket, receipts: receipts.slice(i, i + DRIVE_PART_SIZE) })).fold);
      } catch (e) {
        if (e instanceof DriveError && e.status === 400) return null;
        throw e;
      }
    }
    return out;
  }

  /** 分片清单: 每片的 Bot, TG file_id, 大小 (Drive v0.3.1 起)。 */
  async manifest(id: string): Promise<FileDirect> {
    const res = await this.fetcher.fetch(new Request(`${this.origin}${API}/fs/manifest?id=${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${this.token}` } }));
    if (!res.ok) throw new DriveError(res.status, `Drive ${res.status}`);
    const m = await res.json<FileDirect>();
    return { size: m.size, chunkSize: m.chunkSize, chunks: m.chunks.map((c) => ({ bot: c.bot, fileId: c.fileId, size: c.size })) };
  }

  /** 签名直链, 绑定本令牌: 令牌被吊销后 60 秒内失效。 */
  async link(id: string, ttlSec = DAY_SEC): Promise<string> {
    return (await this.json<{ url: string }>("/fs/link", { id, expiresIn: ttlSec })).url;
  }

  /** 读文件内容 (整个响应, 调用方流式读 body)。 */
  async open(id: string): Promise<Response> {
    const res = await this.fetcher.fetch(new Request(`${this.origin}${API}/files/${encodeURIComponent(id)}/content`, { headers: { authorization: `Bearer ${this.token}` } }));
    if (!res.ok) throw new DriveError(res.status, `Drive ${res.status}`);
    return res;
  }

  async text(id: string): Promise<string> {
    return (await this.open(id)).text();
  }

  /** 立即删除: 进回收站后马上彻底删 (TG 消息当场删)。已经不在了算成功。 */
  async remove(id: string): Promise<void> {
    try {
      await this.json("/fs/delete", { id });
    } catch (e) {
      if (e instanceof DriveError && e.status === 404) return;
      throw e;
    }
    try {
      await this.json("/fs/purge", { id });
    } catch (e) {
      // 404 = 已经不在回收站 (别处已彻底删除)
      if (!(e instanceof DriveError && e.status === 404)) throw e;
    }
  }
}
