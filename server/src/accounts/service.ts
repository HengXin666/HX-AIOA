import { ACCESS_PREFIX, REFRESH_PREFIX, type DeviceInput, type TokenPair, type UserPublic } from "@hx-aioa/protocol";
import { randomSecret } from "../auth";
import { CODE_NOT_CONFIGURED, CODE_RATE_LIMITED, CODE_UNAUTHORIZED, ERR_NEED_SECRET } from "../constants";
import type { Env } from "../env";
import { ApiFail } from "../http";
import { ACCESS_TTL_SEC, ERR_BAD_REFRESH, ERR_TOO_MANY, LOGIN_FAIL_LIMIT, LOGIN_FAIL_WINDOW_MS, USER_HUB_PREFIX } from "./constants";
import { signAccess, verifyAccess } from "./crypto";
import { Directory } from "./directory";

export type Session = { user: UserPublic; session: string };
// 断开会话的长连接: 母号的连接在主 Hub, 子号的在各自 DO
export type Kicker = (user: UserPublic, sessions: string[]) => Promise<void>;

export class Accounts {
  readonly dir: Directory;
  private readonly fails = new Map<string, { since: number; count: number }>();
  // 由 Hub 接上: 用群邀请码注册时直接进群, 删号时退出所有群
  joinRoom?: (uid: string, code: string) => Promise<string>;
  onDelete?: (uid: string) => void;

  constructor(
    sql: SqlStorage,
    private readonly env: Env,
    readonly kick: Kicker,
  ) {
    this.dir = new Directory(sql);
  }

  setupCode(): string | undefined {
    return this.env.SETUP_CODE || undefined;
  }

  secret(): string {
    if (!this.env.TOKEN_SECRET) throw new ApiFail(503, CODE_NOT_CONFIGURED, ERR_NEED_SECRET);
    return this.env.TOKEN_SECRET;
  }

  // 新登录建会话, 刷新时传 session 轮换刷新令牌
  async issue(user: UserPublic, device?: DeviceInput, session?: string): Promise<TokenPair> {
    const secret = this.secret();
    const refresh = randomSecret(REFRESH_PREFIX);
    let sid = session;
    if (sid) await this.dir.rotate(sid, refresh);
    else sid = await this.dir.createSession(user.id, device, refresh);
    const access = await signAccess(secret, ACCESS_PREFIX, { u: user.id, s: sid, e: Date.now() + ACCESS_TTL_SEC * 1000 });
    return { access, refresh, expiresIn: ACCESS_TTL_SEC, session: sid, user };
  }

  async refresh(token: string): Promise<TokenPair> {
    const row = token.startsWith(REFRESH_PREFIX) ? await this.dir.sessionByRefresh(token) : null;
    const user = row ? this.dir.user(row.user) : null;
    if (!row || !user || row.expires <= Date.now() || user.status !== "active") {
      if (row) this.dir.deleteSession(row.id);
      throw new ApiFail(401, CODE_UNAUTHORIZED, ERR_BAD_REFRESH);
    }
    return this.issue(user, undefined, row.id);
  }

  // 校验签名后仍查会话与用户状态, 吊销, 禁用, 改密码都立即生效
  async resolve(token: string): Promise<Session | null> {
    if (!token.startsWith(ACCESS_PREFIX) || !this.env.TOKEN_SECRET) return null;
    const claims = await verifyAccess(this.env.TOKEN_SECRET, ACCESS_PREFIX, token, Date.now());
    if (!claims) return null;
    const row = this.dir.session(claims.s);
    const user = row && row.user === claims.u ? this.dir.user(claims.u) : null;
    if (!user || user.status !== "active") return null;
    return { user, session: claims.s };
  }

  // 按用户名计失败次数, 内存计数, 休眠后清零可以接受
  checkThrottle(name: string, now = Date.now()): void {
    const f = this.fails.get(name);
    if (f && now - f.since < LOGIN_FAIL_WINDOW_MS && f.count >= LOGIN_FAIL_LIMIT) throw new ApiFail(429, CODE_RATE_LIMITED, ERR_TOO_MANY);
  }

  recordFail(name: string, now = Date.now()): void {
    const f = this.fails.get(name);
    if (!f || now - f.since >= LOGIN_FAIL_WINDOW_MS) this.fails.set(name, { since: now, count: 1 });
    else f.count += 1;
  }

  clearFails(name: string): void {
    this.fails.delete(name);
  }

  async revokeAll(user: UserPublic, except?: string): Promise<void> {
    const ids = this.dir.deleteSessions(user.id, except);
    if (ids.length) await this.kick(user, ids);
  }

  userHub(user: UserPublic): DurableObjectStub<import("../hub").Hub> {
    return this.env.HUB.get(this.env.HUB.idFromName(USER_HUB_PREFIX + user.id));
  }
}
