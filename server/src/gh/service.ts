import { GH_PLUGIN_ID, type GhAgent, type GhAuth, type GhAuthKind, type GhDevice, type GhDevicePoll, type GhOp, type GhRepo, type GhRules } from "@hx-aioa/protocol";
import { randomId } from "../auth";
import type { Core, Principal } from "../core";
import type { Env } from "../env";
import { ApiFail } from "../http";
import { GH_CODE, deviceStart, devicePoll, gh, refreshGrant, type TokenGrant } from "./client";
import { seal, unseal } from "./crypto";
import { GhStore, type GhSecret } from "./store";

// 定时任务入口: 同步待办关联的 issue (webhook 漏掉的兜底)
export { syncTodoIssues } from "./todo-sync";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const REPO_TTL = 10 * MIN;
// 令牌剩 5 分钟就先续期
const REFRESH_AHEAD = 5 * MIN;
const PER_PAGE = 100;
const MAX_PAGES = 5;
type Raw = Omit<GhRepo, "allowed">;
type Pending = { code: string; expires: number };

export function repoAllowed(r: Raw, rules: GhRules, now = Date.now()): boolean {
  if (rules.deny?.includes(r.repo)) return false;
  if (rules.repos?.includes(r.repo)) return true;
  if (rules.public && !r.private) return true;
  if (rules.private && r.private) return true;
  return !!rules.pushedDays && r.pushed >= now - rules.pushedDays * DAY;
}

const denied = (text: string) => new ApiFail(403, "forbidden", text);

/** GitHub 授权: 令牌加密存库, 只在服务端用; 仓库范围和 Agent 权限都在这里判。 */
export class GhService {
  readonly store: GhStore;
  private repoCache: { at: number; list: Raw[] } | null = null;
  private readonly pending = new Map<string, Pending>();

  constructor(
    private readonly env: Env,
    sql: SqlStorage,
  ) {
    this.store = new GhStore(sql);
  }

  private get secret(): string {
    return this.env.TOKEN_SECRET || this.env.AUTH_TOKEN;
  }

  get deviceOk(): boolean {
    return !!this.env.GH_CLIENT_ID;
  }

  auth(): GhAuth | undefined {
    const s = this.store.secret();
    if (!s) return undefined;
    const { token: _t, refresh: _r, refreshExpires: _e, ...auth } = s;
    return auth;
  }

  async token(): Promise<string> {
    const s = this.store.secret();
    if (!s) throw new ApiFail(409, "gh_unauthorized", "还没授权 GitHub, 请主人在 App 的 GitHub 授权插件里授权");
    if (s.expires && s.expires - Date.now() < REFRESH_AHEAD) return this.refresh(s);
    return unseal(this.secret, s.token);
  }

  private async refresh(s: GhSecret): Promise<string> {
    const id = this.env.GH_CLIENT_ID;
    const sec = this.env.GH_CLIENT_SECRET;
    if (!id || !sec || !s.refresh) throw new ApiFail(401, "gh_expired", "GitHub 授权已过期, 请主人重新授权");
    const g = await refreshGrant(id, sec, await unseal(this.secret, s.refresh));
    if (!g.access_token) throw new ApiFail(401, "gh_expired", `GitHub 续期失败: ${g.error ?? "未知"}, 请重新授权`);
    await this.save(s.kind, g, s.login);
    return g.access_token;
  }

  private async save(kind: GhAuthKind, g: TokenGrant, login?: string): Promise<GhAuth> {
    const token = g.access_token!;
    const who = login ?? String(((await gh(token, "/user")).body as { login?: unknown }).login ?? "");
    const now = Date.now();
    const s: GhSecret = {
      login: who,
      kind,
      since: this.store.secret()?.login === who ? (this.store.secret()?.since ?? now) : now,
      token: await seal(this.secret, token),
      ...(g.expires_in ? { expires: now + g.expires_in * 1000 } : {}),
      ...(g.refresh_token ? { refresh: await seal(this.secret, g.refresh_token) } : {}),
      ...(g.refresh_token_expires_in ? { refreshExpires: now + g.refresh_token_expires_in * 1000 } : {}),
    };
    this.store.setSecret(s);
    this.repoCache = null;
    return this.auth()!;
  }

  setPat(token: string): Promise<GhAuth> {
    return this.save("pat", { access_token: token });
  }

  revoke(): void {
    this.store.setSecret(null);
    this.repoCache = null;
  }

  async startDevice(): Promise<GhDevice> {
    const id = this.env.GH_CLIENT_ID;
    if (!id) throw new ApiFail(400, "bad_request", "服务端没配 GH_CLIENT_ID, 先用令牌授权");
    const d = await deviceStart(id);
    if (!d.device_code) throw new ApiFail(502, GH_CODE, "GitHub 没返回设备码, 检查应用是否开了 Device Flow");
    const key = randomId("ghd_");
    const expires = Date.now() + d.expires_in * 1000;
    this.pending.set(key, { code: d.device_code, expires });
    return { id: key, userCode: d.user_code, verifyUrl: d.verification_uri, expires, interval: d.interval };
  }

  async pollDevice(key: string): Promise<GhDevicePoll> {
    const p = this.pending.get(key);
    if (!p || p.expires < Date.now()) {
      this.pending.delete(key);
      return { status: "expired" };
    }
    const g = await devicePoll(this.env.GH_CLIENT_ID!, p.code);
    if (g.access_token) {
      this.pending.delete(key);
      return { status: "done", auth: await this.save("oauth", g) };
    }
    if (g.error === "authorization_pending" || g.error === "slow_down") return { status: "pending" };
    this.pending.delete(key);
    return { status: g.error === "access_denied" ? "denied" : "expired" };
  }

  private async raw(fresh = false): Promise<Raw[]> {
    if (!fresh && this.repoCache && Date.now() - this.repoCache.at < REPO_TTL) return this.repoCache.list;
    const token = await this.token();
    const list: Raw[] = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const body = (await gh(token, `/user/repos?per_page=${PER_PAGE}&page=${page}&sort=pushed`)).body;
      if (!Array.isArray(body)) break;
      for (const r of body as { full_name?: string; private?: boolean; pushed_at?: string }[]) {
        if (r.full_name) list.push({ repo: r.full_name, private: !!r.private, pushed: r.pushed_at ? Date.parse(r.pushed_at) : 0 });
      }
      if (body.length < PER_PAGE) break;
    }
    this.repoCache = { at: Date.now(), list };
    return list;
  }

  async repos(fresh = false): Promise<GhRepo[]> {
    const rules = this.store.rules();
    return (await this.raw(fresh)).map((r) => ({ ...r, allowed: repoAllowed(r, rules) }));
  }

  /** 操作前检查: 仓库在授权范围内, 否则 403 并说明怎么放行。 */
  async ensureRepo(repo: string): Promise<void> {
    const r = (await this.raw()).find((x) => x.repo.toLowerCase() === repo.toLowerCase());
    if (!r) throw denied(`令牌看不到 ${repo}, 请主人在 GitHub 上给它授权`);
    if (!repoAllowed(r, this.store.rules())) throw denied(`${repo} 不在允许的仓库里, 请主人在 GitHub 授权插件里放行`);
  }

  /** 主人随时可用; Agent 看开关, 没设过时插件声明了 gh 依赖就默认开。 */
  canUse(core: Core, who: Principal): boolean {
    if (who.owner) return true;
    if (who.member || who.key.ext) return false;
    const set = this.store.grants()[who.key.id];
    return set ?? this.depDefault(core, who.key.id);
  }

  private depDefault(core: Core, keyId: string): boolean {
    return core.plugins.list().some((p) => p.keyId === keyId && p.deps?.includes(GH_PLUGIN_ID));
  }

  agents(core: Core): GhAgent[] {
    const grants = this.store.grants();
    return core.chats.chats().flatMap((m) =>
      (m.agents ?? []).map((a) => {
        const dep = this.depDefault(core, a.keyId);
        return { keyId: a.keyId, name: a.name, channel: m.title || m.channel, allowed: grants[a.keyId] ?? dep, dep };
      }),
    );
  }

  log(core: Core, who: Principal, op: Omit<GhOp, "ts" | "by">): void {
    const by = who.owner ? "主人" : (core.chats.chats().flatMap((m) => m.agents ?? []).find((a) => a.keyId === who.key.id)?.name ?? who.key.name);
    this.store.log({ ts: Date.now(), by, ...op });
  }
}
