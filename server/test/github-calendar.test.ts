import assert from "node:assert/strict";
import { test } from "node:test";
import { HeatYears, emptyState } from "../src/github/backfill";
import { calendarStep, yearsToFetch } from "../src/github/calendar";
import { memKv } from "./github-kv";

const NOW = Date.UTC(2026, 10, 28, 2);

test("贡献日历回填: 先拉今年拿到注册时间, 同一次把往年全部补上 (#140)", async () => {
  const state = emptyState(NOW);
  const years = new HeatYears(memKv().storage);
  const asked: number[] = [];
  const fake = async (_t: string, y: number) => {
    asked.push(y);
    return { created: "2024-04-05T06:16:00Z", days: [{ date: `${y}-06-01`, contributionCount: y - 2000 }, { date: `${y}-06-02`, contributionCount: 0 }] };
  };
  assert.equal(await calendarStep("t", state, years, NOW, fake), 3);
  assert.deepEqual(asked.sort(), [2024, 2025, 2026]);
  assert.equal(years.count("2025-06-01"), 25);
  assert.deepEqual(state.years.sort(), [2024, 2025, 2026]);
  assert.equal(state.oldest, "2024-06-01");
  // 往年拉过不再拉, 今年 10 分钟内也不重拉
  assert.deepEqual(yearsToFetch(state.cal!, 2026, NOW + 60_000), []);
  assert.deepEqual(yearsToFetch(state.cal!, 2026, NOW + 11 * 60_000), [2026]);
});
