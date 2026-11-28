import { DRIVE_AIOA_DIR } from "@hx-aioa/protocol";
import type { Env } from "../env";
import { attachDirOf, tokenRoot } from "../files/drive";

const API = "/api/v1";

/**
 * 网盘用的 Drive 客户端: 只走 Service Binding。整盘令牌 CFD_DRIVE_TOKEN 优先, 没配时用附件令牌 CFD_TOKEN。
 * 和附件的 Drive 客户端分开: 这里只做转发, 状态码与错误交给调用方。
 * 令牌能看到哪里以 Drive 里的根目录为准 (#157): 根是 / 就是整盘, 根是 /aioa 只看附件所在的目录; 用前先 ready()。
 */
export class DriveFs {
  // 令牌根在 Drive 里的绝对路径, ready() 后才准
  rootAbs: string;

  constructor(
    private readonly fetcher: Fetcher,
    readonly origin: string,
    private readonly token: string,
    dedicated: boolean,
  ) {
    // 问到之前按令牌种类猜: 专用令牌按整盘, 附件令牌按 /aioa
    this.rootAbs = dedicated ? "/" : DRIVE_AIOA_DIR;
  }

  static from(env: Env): DriveFs | undefined {
    const origin = env.CFD_ORIGIN?.trim().replace(/\/+$/, "");
    const token = env.CFD_DRIVE_TOKEN || env.CFD_TOKEN;
    return env.DRIVE && token && origin ? new DriveFs(env.DRIVE, origin, token, !!env.CFD_DRIVE_TOKEN) : undefined;
  }

  /** 问一次令牌根 (每个 isolate 按令牌缓存 10 分钟); 问不到时保持猜测。 */
  async ready(): Promise<this> {
    this.rootAbs = (await tokenRoot(this.fetcher, this.origin, this.token)) ?? this.rootAbs;
    return this;
  }

  /** 整盘: 令牌根是 /, 路径从 Drive 根算, 附件在 /aioa 下; 否则路径从令牌根算。 */
  get whole(): boolean {
    return this.rootAbs === "/";
  }

  /** 网盘里显示的根 (Drive 里的绝对路径)。 */
  get root(): string {
    return this.rootAbs;
  }

  /** 附件月目录在本令牌下的路径 (attach 复制到这里); 令牌看不到 /aioa 时为 null。 */
  attachDir(now = Date.now()): string | null {
    return attachDirOf(this.rootAbs, now);
  }

  fetch(method: string, path: string, body?: BodyInit | null, headers: Record<string, string> = {}): Promise<Response> {
    return this.fetcher.fetch(new Request(`${this.origin}${API}${path}`, { method, body, headers: { authorization: `Bearer ${this.token}`, ...headers } }));
  }

  json(method: string, path: string, body?: unknown): Promise<Response> {
    return this.fetch(method, path, body === undefined ? undefined : JSON.stringify(body), body === undefined ? {} : { "content-type": "application/json" });
  }

  /** 按 id 取节点路径; 不存在返回 null。 */
  async pathOf(id: string): Promise<string | null> {
    const res = await this.fetch("GET", `/fs/stat?id=${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    return (await res.json<{ path?: string }>()).path ?? null;
  }
}
