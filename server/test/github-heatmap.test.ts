import assert from "node:assert/strict";
import { test } from "node:test";
import { GITHUB_HEATMAP_DAYS, type GithubActivityItem } from "@hx-aioa/protocol";
import { ActivityStore } from "../src/github/activity";
import { commitsByDate, dateIn, heatmapOf, lastDates, mergeHeat } from "../src/github/heatmap";
import { GithubService } from "../src/github/service";
import { memSql } from "./sql";

const TZ = "Asia/Shanghai";
const NOW = Date.parse("2026-11-27T22:30:00+08:00");
const DAY = 24 * 3600_000;
const push = (ts: number, commits?: number): GithubActivityItem => ({ id: `p${ts}`, ts, kind: "push", repo: "a/b", title: "推送", url: "", ...(commits ? { commits } : {}) });

function kv() {
  const m = new Map<string, unknown>();
  return { get: async (k: string) => m.get(k), put: async (k: string, v: unknown) => void m.set(k, v), delete: async () => true } as unknown as DurableObjectStorage;
}

test("热力图日期: 按 IANA 时区分天, 140 天从早到晚, 跨月正确", () => {
  assert.equal(dateIn(Date.parse("2026-11-27T17:00:00Z"), TZ), "2026-11-28");
  const d = lastDates("2026-03-02", 3);
  assert.deepEqual(d, ["2026-02-28", "2026-03-01", "2026-03-02"]);
  const m = commitsByDate([push(NOW, 3), push(NOW - 1000), { ...push(NOW, 9), kind: "pr" }], TZ);
  assert.equal(m.get("2026-11-27"), 4);
});

test("累计: 已存的老日子保留, 同一天取较大值, 超过 140 天的丢掉 (#134)", () => {
  const today = dateIn(NOW, TZ);
  const old = dateIn(NOW - 100 * DAY, TZ);
  const tooOld = dateIn(NOW - 200 * DAY, TZ);
  const prev = { days: { [old]: 7, [tooOld]: 3, [today]: 5 }, updated: 1 };
  const next = mergeHeat(prev, new Map([[today, 2]]), today, NOW);
  assert.deepEqual(next, { days: { [old]: 7, [today]: 5 }, updated: NOW });
  const view = heatmapOf(next, new Map([[today, 9]]), today);
  assert.equal(view.days.length, GITHUB_HEATMAP_DAYS);
  assert.equal(view.days.at(-1)?.commits, 9);
  assert.equal(view.days.find((x) => x.date === old)?.commits, 7);
});

test("服务: 第一次读当场算并存一行, 之后读不写; 新提交改变 ETag (#134)", async () => {
  const sql = memSql();
  const storage = kv();
  const svc = new GithubService({} as never, sql, storage, {} as never);
  const acts = new ActivityStore(sql);
  acts.add([push(NOW - 3 * DAY, 2), push(NOW - 3 * DAY + 1000, 1)], NOW);
  const a = await svc.heatmap(TZ, NOW);
  assert.equal(a.map.days.find((x) => x.date === dateIn(NOW - 3 * DAY, TZ))?.commits, 3);
  assert.ok(await storage.get("githubHeatmap"));
  const b = await svc.heatmap(TZ, NOW);
  assert.equal(b.tag, a.tag);
  acts.add([push(NOW - 1000, 4)], NOW);
  const c = await svc.heatmap(TZ, NOW);
  assert.notEqual(c.tag, a.tag);
  assert.equal(c.map.days.at(-1)?.commits, 4);
});
