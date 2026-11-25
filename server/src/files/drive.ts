import type { Env } from "../env";

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

/**
 * HX-CF-Drive 客户端。只走 Service Binding (同账号, 不经过公网和 WAF), 令牌是 Drive 后台建的受限令牌 (根目录 /aioa)。
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

  /** 第 3 步: 交全部回执, 返回 Drive 的文件节点。 */
  async commit(ticket: string, receipts: string[]): Promise<NodeOut> {
    const r = await this.json<{ node: NodeOut }>("/uploads/commit", { ticket, receipts });
    return { id: r.node.id, size: r.node.size };
  }

  /** 签名直链, 绑定本令牌: 令牌被吊销后 60 秒内失效。 */
  async link(id: string, ttlSec = DAY_SEC): Promise<string> {
    return (await this.json<{ url: string }>("/fs/link", { id, expiresIn: ttlSec })).url;
  }

  async text(id: string): Promise<string> {
    const res = await this.fetcher.fetch(new Request(`${this.origin}${API}/files/${encodeURIComponent(id)}/content`, { headers: { authorization: `Bearer ${this.token}` } }));
    if (!res.ok) throw new DriveError(res.status, `Drive ${res.status}`);
    return res.text();
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
