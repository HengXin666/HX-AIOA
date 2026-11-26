import { TIMER_AGG_PREFIX, TIMER_FALLBACK, TIMER_PROMPT_PREFIX } from "./constants";
import type { Core } from "./core";
import { TIMER_MIGRATE } from "./files/migrate";
import { TIMER_TODO } from "./plugins/todo-remind";

/** DO 共用闹钟到点后按名字分派: 兜底推送, 聚合窗口, 确认超时, 冷迁移, 待办提醒。 */
export async function runTimer(core: Core, name: string): Promise<void> {
  if (name === TIMER_FALLBACK) await core.pipeline.runFallback();
  else if (name.startsWith(TIMER_AGG_PREFIX)) await core.pipeline.flushBucket(name.slice(TIMER_AGG_PREFIX.length));
  else if (name.startsWith(TIMER_PROMPT_PREFIX)) await core.agents.expire(name.slice(TIMER_PROMPT_PREFIX.length));
  else if (name === TIMER_MIGRATE) await core.migrator.tick();
  else if (name === TIMER_TODO) await core.remind.fire();
}
