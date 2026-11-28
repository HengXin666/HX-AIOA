// plan: 重算定时 (#161)。把宿主额度交给服务端, 服务端按本群消息时段算出新 cron; 打印给模型读的结果与下一步
import { ApiError, call } from "./http.mjs";
import { PATH_AGENT_PLAN } from "./proto.mjs";

const QUOTA_KEYS = ["pool-used", "pool-reset", "daily-used"];

function bodyOf(v) {
  const given = QUOTA_KEYS.filter((k) => v[k] !== undefined);
  if (given.length && given.length !== QUOTA_KEYS.length) throw new ApiError(0, "额度三项 --pool-used --pool-reset --daily-used 要么都给, 要么都不给");
  const body = {};
  if (given.length) {
    body.poolUsed = Number(v["pool-used"]);
    body.dailyUsed = Number(v["daily-used"]);
    body.poolReset = v["pool-reset"];
  }
  if (v["min-interval"] !== undefined) body.minInterval = Number.parseInt(v["min-interval"], 10);
  return body;
}

export function planText(r) {
  const peak = r.peakIntervalMin ? `高峰 ${r.peakHour} 点每 ${r.peakIntervalMin} 分钟一次` : "没有高峰";
  const budget = r.budget === "quota" ? `单次约 ${r.cost}% 额度, 距额度重置 ${r.daysUntilReset} 天` : "没给额度, 保持现有每天次数, 只按时段重新分配";
  const mode = r.mode === "fitted" ? `按近 ${r.days} 天 ${r.events} 条消息的时段分配` : `历史不够 (${r.days} 天 ${r.events} 条), 先均匀分布`;
  return [
    `== 新定时 (时区 ${r.tz})`,
    `每天 ${r.runsPerDay} 次, ${peak}; ${budget}; ${mode}`,
    "cron (每行一个定时, 宿主支持多条时全用):",
    ...r.cron.map((c) => `  ${c}`),
    `只能写一条时用: ${r.single}`,
    `每小时次数: ${r.perHour.join(" ")}`,
  ];
}

export async function plan(cfg, v, out) {
  const r = await call(cfg, "POST", PATH_AGENT_PLAN, bodyOf(v));
  if (v.json) return out(r);
  out([...planText(r), `下一步: 把本任务的定时改成上面的 cron (时区 ${r.tz}), 运行 hxaioa me --trigger "<改后的表达式>", 和原来的不一样时再用 hxaioa send 一句话告诉主人: 每天次数, 高峰间隔, 单次成本; 一样就什么都不发`].join("\n"));
}
