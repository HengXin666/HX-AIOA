import type { GithubSyncResult } from "@hx-aioa/protocol";
import { cfUsage } from "./api-cf";
import { messageInput } from "./api-events";
import type { Core } from "./core";
import { ghOn } from "./gh/gate";
import { syncTodoIssues, SYNC_FAIL } from "./gh/todo-sync";
import { githubOn } from "./github/gate";

const CF_SOURCE = "CF 额度";
const KEY_CF_ALERT = "cf_alert_day";
const CF_ALERT_RATIO = 0.8;
const PCT = 100;

/** 任一 CF 额度用到 80% 时提醒一次, 每天最多一条。 */
async function cfCheck(core: Core, storage: DurableObjectStorage): Promise<void> {
  const u = await cfUsage(core.env);
  const hot = (u.items ?? []).filter((i) => i.used >= i.limit * CF_ALERT_RATIO);
  if (!hot.length || !u.day || (await storage.get<string>(KEY_CF_ALERT)) === u.day) return;
  await storage.put(KEY_CF_ALERT, u.day);
  const text = `今天 (UTC) 的 CF 免费额度已用超过 80%: ${hot.map((i) => `${i.label} ${Math.round((i.used / i.limit) * PCT)}%`).join(", ")}`;
  const input = messageInput({ text });
  if (typeof input !== "string") await core.pipeline.fromInput(input, { source: { id: CF_SOURCE, name: CF_SOURCE }, sourceInfo: null });
}

const KEY_GH_NOTICE = "gh_expiry_notice";
const GH_WARN_AHEAD = 2 * 60 * 60_000;
const MIN = 60_000;

/** GitHub 授权会过期又不能自动续期时, 到期前 2 小时提醒主人一次 (每个到期时间一条)。 */
async function ghExpiryCheck(core: Core, storage: DurableObjectStorage): Promise<void> {
  const a = core.gh.auth();
  if (!a?.expires || a.renewable || a.expires - Date.now() > GH_WARN_AHEAD) return;
  if ((await storage.get<number>(KEY_GH_NOTICE)) === a.expires) return;
  await storage.put(KEY_GH_NOTICE, a.expires);
  const left = Math.round((a.expires - Date.now()) / MIN);
  const when = left > 0 ? `约 ${left} 分钟后过期` : "已经过期";
  const text = `GitHub 授权 (${a.login}) ${when}, 部署没配 GH_CLIENT_SECRET 不能自动续期。请在 App 的 GitHub 授权插件里重新授权, 或按 docs/features/gh.md 配置续期。`;
  const input = messageInput({ text });
  if (typeof input !== "string") await core.pipeline.fromInput(input, { source: { id: "system:gh", name: "系统", icon: "github" }, sourceInfo: null });
}

/**
 * cron 每 30 分钟一次 RPC 做完三件事: CF 额度检查, 待办关联 issue 同步, GitHub 回填。
 * 各项按配置与插件启用状态 (内核内存) 跳过, 不多一次 DO 请求。
 */
export async function halfHourly(core: Core, storage: DurableObjectStorage): Promise<GithubSyncResult | null> {
  const env = core.env;
  const cf = env.CF_API_TOKEN && env.CF_ACCOUNT_ID ? cfCheck(core, storage).catch((e) => console.error("CF 额度检查失败:", e)) : null;
  const todos = ghOn(core) ? syncTodoIssues(core).catch((e) => console.error(SYNC_FAIL, e)) : null;
  const github = githubOn(core) && env.GITHUB_TOKEN ? core.github.sync().catch((e) => (console.error("GitHub 回填失败:", e), null)) : null;
  const ghWarn = ghOn(core) ? ghExpiryCheck(core, storage).catch((e) => console.error("GitHub 授权到期检查失败:", e)) : null;
  const [, , r] = await Promise.all([cf, todos, github, ghWarn]);
  return r ?? null;
}
