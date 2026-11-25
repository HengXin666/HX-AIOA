import type { GithubSyncResult } from "@hx-aioa/protocol";
import { cfUsage } from "./api-cf";
import { messageInput } from "./api-events";
import type { Core } from "./core";
import { ghOn } from "./gh/gate";
import { syncTodoIssues } from "./gh/todo-sync";
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

/**
 * cron 每 30 分钟一次 RPC 做完三件事: CF 额度检查, 待办关联 issue 同步, GitHub 回填。
 * 各项按配置与插件启用状态 (内核内存) 跳过, 不多一次 DO 请求。
 */
export async function halfHourly(core: Core, storage: DurableObjectStorage): Promise<GithubSyncResult | null> {
  const env = core.env;
  const cf = env.CF_API_TOKEN && env.CF_ACCOUNT_ID ? cfCheck(core, storage).catch((e) => console.error("CF 额度检查失败:", e)) : null;
  const todos = ghOn(core) ? syncTodoIssues(core).catch((e) => console.error("待办 issue 同步失败:", e)) : null;
  const github = githubOn(core) && env.GITHUB_TOKEN ? core.github.sync().catch((e) => (console.error("GitHub 回填失败:", e), null)) : null;
  const [, , r] = await Promise.all([cf, todos, github]);
  return r ?? null;
}
