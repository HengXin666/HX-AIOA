import { DRIVE_AIOA_DIR } from "@hx-aioa/protocol";
import type { Env } from "../env";
import { driveDir } from "../files/store";

const API = "/api/v1";

/**
 * 网盘用的 Drive 客户端: 只走 Service Binding。整盘令牌 CFD_DRIVE_TOKEN 优先, 没配时退回附件令牌 CFD_TOKEN (根目录 /aioa)。
 * 和附件的 Drive 客户端分开: 令牌不同, 这里只做转发, 状态码与错误交给调用方。
 */
export class DriveFs {
  constructor(
    private readonly fetcher: Fetcher,
    readonly origin: string,
    private readonly token: string,
    // 整盘令牌: 路径从 Drive 根算; 否则从 /aioa 算
    readonly whole: boolean,
  ) {}

  static from(env: Env): DriveFs | undefined {
    const origin = env.CFD_ORIGIN?.trim().replace(/\/+$/, "");
    const token = env.CFD_DRIVE_TOKEN || env.CFD_TOKEN;
    return env.DRIVE && token && origin ? new DriveFs(env.DRIVE, origin, token, !!env.CFD_DRIVE_TOKEN) : undefined;
  }

  /** 网盘里显示的根: 整盘为 /, 退回时为 /aioa。 */
  get root(): string {
    return this.whole ? "/" : DRIVE_AIOA_DIR;
  }

  /** 附件月目录在本令牌下的路径 (attach 复制到这里)。 */
  attachDir(now = Date.now()): string {
    return this.whole ? `${DRIVE_AIOA_DIR}${driveDir(now)}` : driveDir(now);
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
