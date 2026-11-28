import type { GithubSyncResult } from "@hx-aioa/protocol";
import { cfUsage } from "./api-cf";
import { flushActive } from "./api-presence";
import { messageInput } from "./api-events";
import type { Core } from "./core";
import { ghOn } from "./gh/gate";
import { syncTodoIssues, SYNC_FAIL } from "./gh/todo-sync";
import { githubOn } from "./github/gate";
import { ApiFail } from "./http";
import { systemNotice } from "./system-notice";

export { majorRemind } from "./agent-want";

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
  if (typeof input !== "string") await systemNotice(core, input, { id: "system:cf", name: CF_SOURCE, icon: "cloud" });
}

/** 每天的 cron: 启用了 GitHub 插件时把动态累计进提交热力图 (#134), 一行一次写。 */
export async function heatmapDaily(core: Core): Promise<void> {
  if (githubOn(core)) await core.github.refreshHeatmap(await core.config.tz());
}

const KEY_GH_NOTICE = "gh_expiry_notice";

/** GitHub 授权到了本地记的到期时间又不能自动续时, 实际探一次; GitHub 真拒绝了才提醒主人 (每个到期时间一条)。 */
async function ghExpiryCheck(core: Core, storage: DurableObjectStorage): Promise<void> {
  const a = core.gh.auth();
  if (!a?.expires || a.renewable || a.expires > Date.now()) return;
  if ((await storage.get<number>(KEY_GH_NOTICE)) === a.expires) return;
  const dead = await core.gh.call("/user").then(
    () => false,
    (e: unknown) => e instanceof ApiFail && e.code === "gh_expired",
  );
  if (!dead) return;
  const text = `GitHub 授权 (${a.login}) 已被 GitHub 拒绝 (过期或撤销), 不能自动续期。请在 App 的 GitHub 授权插件里重新授权。`;
  const input = messageInput({ text });
  if (typeof input === "string") return;
  await systemNotice(core, input, { id: "system:gh-auth", name: "GitHub 授权", icon: "github" });
  // 发成功才记, 发失败下次 cron 再提醒
  await storage.put(KEY_GH_NOTICE, a.expires);
}

/**
 * cron 每 30 分钟一次 RPC 做完: Agent 活跃落库, CF 额度检查, 待办关联 issue 同步, GitHub 回填。
 * 各项按配置与插件启用状态 (内核内存) 跳过, 不多一次 DO 请求。
 */
export async function halfHourly(core: Core, storage: DurableObjectStorage): Promise<GithubSyncResult | null> {
  const env = core.env;
  flushActive(core);
  try {
    core.agentGui.sweep();
  } catch (e) {
    console.error("Agent GUI 审批清理失败:", e);
  }
  const cf = env.CF_API_TOKEN && env.CF_ACCOUNT_ID ? cfCheck(core, storage).catch((e) => console.error("CF 额度检查失败:", e)) : null;
  const todos = ghOn(core) ? syncTodoIssues(core).catch((e) => console.error(SYNC_FAIL, e)) : null;
  const github = githubOn(core) && env.GITHUB_TOKEN ? core.github.sync().catch((e) => (console.error("GitHub 回填失败:", e), null)) : null;
  const ghWarn = ghOn(core) ? ghExpiryCheck(core, storage).catch((e) => console.error("GitHub 授权到期检查失败:", e)) : null;
  const [, , r] = await Promise.all([cf, todos, github, ghWarn]);
  return r ?? null;
}
