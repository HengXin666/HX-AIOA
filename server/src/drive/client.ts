import { DRIVE_AIOA_DIR, DRIVE_ROOT_DIR } from "@hx-aioa/protocol";
import type { Env } from "../env";
import { attachDirOf, tokenRoot } from "../files/drive";
import { DriveFail, failOf } from "./relay";

const API = "/api/v1";
// Drive 的请求头: 把这次请求的根收窄到令牌根下的子目录 (Drive #18), 网盘靠它和附件目录隔离
const SCOPE_HEADER = "X-Drive-Scope";
const SCOPE_TTL_MS = 10 * 60_000;
const scopes = new Map<string, number>();

/** 令牌根 abs 下的网盘根 (Drive 绝对路径)。 */
export const driveRootOf = (tokenAbs: string): string => (tokenAbs === "/" ? DRIVE_ROOT_DIR : `${tokenAbs}${DRIVE_ROOT_DIR}`);

/**
 * 网盘用的 Drive 客户端: 只走 Service Binding。整盘令牌 CFD_DRIVE_TOKEN 优先, 没配时用附件令牌 CFD_TOKEN。
 * 网盘有独立根目录 (#158): 默认每个请求带 X-Drive-Scope, Drive 按令牌根下的 /drive 隔离路径, 搜索, 回收站, 分享,
 * 附件与邮件目录从网盘里看不到也够不着。unscoped() 是令牌根视角, 只给迁移与发到群用。用前先 ready()。
 */
export class DriveFs {
  // 令牌根在 Drive 里的绝对路径, ready() 后才准
  tokenAbs: string;

  constructor(
    private readonly fetcher: Fetcher,
    readonly origin: string,
    private readonly token: string,
    dedicated: boolean,
    readonly scoped = true,
  ) {
    // 问到之前按令牌种类猜: 专用令牌按整盘, 附件令牌按 /aioa
    this.tokenAbs = dedicated ? "/" : DRIVE_AIOA_DIR;
  }

  static from(env: Env): DriveFs | undefined {
    const origin = env.CFD_ORIGIN?.trim().replace(/\/+$/, "");
    const token = env.CFD_DRIVE_TOKEN || env.CFD_TOKEN;
    return env.DRIVE && token && origin ? new DriveFs(env.DRIVE, origin, token, !!env.CFD_DRIVE_TOKEN) : undefined;
  }

  /** 问令牌根 (每个 isolate 缓存 10 分钟); 收窄的客户端再确认 Drive 认得 X-Drive-Scope, 否则隔离不成立, 拒绝服务。 */
  async ready(now = Date.now()): Promise<this> {
    this.tokenAbs = (await tokenRoot(this.fetcher, this.origin, this.token, now)) ?? this.tokenAbs;
    if (!this.scoped) return this;
    const key = `${this.origin} ${this.token} ${this.tokenAbs}`;
    const at = scopes.get(key);
    if (at !== undefined && now - at < SCOPE_TTL_MS) return this;
    const res = await this.fetch("GET", "/fs/stat?path=%2F");
    if (!res.ok) throw await failOf(res);
    const path = (await res.json<{ path?: unknown }>().catch(() => ({}) as { path?: unknown })).path;
    if (path !== this.rootAbs) throw new DriveFail(503, "HX-CF-Drive 版本过旧, 不支持网盘独立根目录 (X-Drive-Scope), 请先升级 Drive", "drive_outdated");
    scopes.set(key, now);
    return this;
  }

  /** 令牌根视角的同一个客户端 (不带 X-Drive-Scope), 路径相对令牌根。 */
  unscoped(): DriveFs {
    const fs = new DriveFs(this.fetcher, this.origin, this.token, false, false);
    fs.tokenAbs = this.tokenAbs;
    return fs;
  }

  /** 整盘: 令牌根是 /。 */
  get whole(): boolean {
    return this.tokenAbs === "/";
  }

  /** 本客户端看到的 "/" 在 Drive 里的绝对路径: 收窄时是网盘根。 */
  get rootAbs(): string {
    return this.scoped ? driveRootOf(this.tokenAbs) : this.tokenAbs;
  }

  /** 网盘根 (Drive 里的绝对路径)。 */
  get root(): string {
    return driveRootOf(this.tokenAbs);
  }

  /** 附件月目录相对令牌根的路径 (只对 unscoped 有意义); 令牌看不到 /aioa 时为 null。 */
  attachDir(now = Date.now()): string | null {
    return attachDirOf(this.tokenAbs, now);
  }

  fetch(method: string, path: string, body?: BodyInit | null, headers: Record<string, string> = {}): Promise<Response> {
    const scope: Record<string, string> = this.scoped ? { [SCOPE_HEADER]: DRIVE_ROOT_DIR } : {};
    return this.fetcher.fetch(new Request(`${this.origin}${API}${path}`, { method, body, headers: { authorization: `Bearer ${this.token}`, ...scope, ...headers } }));
  }

  json(method: string, path: string, body?: unknown): Promise<Response> {
    return this.fetch(method, path, body === undefined ? undefined : JSON.stringify(body), body === undefined ? {} : { "content-type": "application/json" });
  }
}
