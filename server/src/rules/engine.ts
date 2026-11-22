import { globMatch, type DeliveryChannel, type Envelope, type Rule, type RouteInfo, type RuleAction, type TimeWindow } from "@hx-aioa/protocol";
import { BUILTIN_RULES } from "./builtin";
import { inWindow } from "./window";

export const DEFAULT_AGGREGATE_SEC = 300;
export const PUSH_CHANNELS: DeliveryChannel[] = ["ws", "mipush", "wxpusher"];
const QUIET_CHANNELS: DeliveryChannel[] = ["ws"];
const RINGING: RuleAction[] = ["alert", "push"];

export type RuleSets = { user: Rule[]; source: Rule[] };

// 聚合与降噪需要的历史, 由调用方从收件箱查好再传入, 引擎本身保持纯函数
export type RuleContext = {
  now: number;
  tz: string;
  quiet?: TimeWindow;
  groupRoot?: { id: string; count: number };
  recentSame?: number;
  previous?: Envelope;
};

const any = <T>(list: T[] | undefined, test: (x: T) => boolean) => !list || list.length === 0 || list.some(test);

function textOf(ev: Envelope): string {
  if (ev.kind === "event") return `${ev.data.title} ${ev.data.summary ?? ""}`;
  if (ev.kind === "report") return `${ev.data.title} ${ev.data.summary ?? ""}`;
  if (ev.kind === "task") return `${ev.data.title} ${ev.data.summary ?? ""} ${ev.data.prompt?.question ?? ""}`;
  return "";
}

export function statusOf(ev: Envelope): string | undefined {
  if (ev.kind === "event") return ev.data.status ?? (ev.resolved ? "resolved" : undefined);
  return ev.resolved ? "resolved" : undefined;
}

export function matchRule(rule: Rule, ev: Envelope, ctx: Pick<RuleContext, "now" | "tz">): boolean {
  if (!rule.enabled) return false;
  const w = rule.when;
  const src = [ev.source.id, ev.source.name, ev.source.type ?? ""];
  if (!any(w.sources, (p) => src.some((s) => globMatch(p, s)))) return false;
  if (!any(w.subjects, (p) => globMatch(p, ev.subject ?? ""))) return false;
  if (!any(w.channels, (p) => globMatch(p, ev.channel ?? ""))) return false;
  if (!any(w.kinds, (k) => k === ev.kind)) return false;
  if (!any(w.priorities, (p) => p === ev.priority)) return false;
  if (w.severities?.length && !(ev.kind === "event" && w.severities.includes(ev.data.severity))) return false;
  if (w.statuses?.length && !w.statuses.some((s) => s === statusOf(ev))) return false;
  if (w.keywords?.length) {
    const text = textOf(ev).toLowerCase();
    if (!w.keywords.some((k) => text.includes(k.toLowerCase()))) return false;
  }
  return inWindow(rule.window, ctx.now, ctx.tz);
}

export function defaultChannels(action: RuleAction): DeliveryChannel[] {
  if (action === "drop") return [];
  return RINGING.includes(action) ? [...PUSH_CHANNELS] : [...QUIET_CHANNELS];
}

export function pickRule(ev: Envelope, sets: RuleSets, ctx: RuleContext): Rule {
  for (const rule of [...sets.user, ...sets.source, ...BUILTIN_RULES]) if (matchRule(rule, ev, ctx)) return rule;
  return BUILTIN_RULES[BUILTIN_RULES.length - 1] as Rule;
}

const severityRank = { info: 0, normal: 1, warning: 2, critical: 3 } as const;

// 同一事件 (同 id) 的后续更新只在升级或状态变化时再提醒
function isQuietUpdate(ev: Envelope, prev: Envelope | undefined): boolean {
  if (!prev || prev.kind !== ev.kind) return false;
  if (ev.kind === "event" && prev.kind === "event") {
    if (severityRank[ev.data.severity] > severityRank[prev.data.severity]) return false;
    return statusOf(ev) === statusOf(prev);
  }
  if (ev.kind === "task" && prev.kind === "task") return ev.data.state === prev.data.state;
  return true;
}

function downgrade(route: RouteInfo, reason: string, merged?: number): RouteInfo {
  const out: RouteInfo = { ...route, action: "silent", channels: route.channels.filter((c) => c === "ws" || c === "next_open"), reason };
  if (merged !== undefined) out.merged = merged;
  return out;
}

// 规则引擎主入口: 命中规则 -> 免打扰 -> 关联只推根因 -> 同一事件更新 -> 短时间同类合并
export function decide(ev: Envelope, sets: RuleSets, ctx: RuleContext): RouteInfo {
  const rule = pickRule(ev, sets, ctx);
  let route: RouteInfo = { action: rule.action, channels: rule.channels?.length ? [...rule.channels] : defaultChannels(rule.action), rule: rule.id };
  if (rule.action === "aggregate") route.reason = `聚合窗口 ${rule.aggregateSec ?? DEFAULT_AGGREGATE_SEC} 秒`;
  if (!RINGING.includes(route.action)) return route;
  if (ctx.quiet && !rule.bypassQuiet && inWindow(ctx.quiet, ctx.now, ctx.tz)) return downgrade(route, "免打扰时段");
  if (ctx.groupRoot && ctx.groupRoot.id !== ev.id) return downgrade(route, "关联事件, 只推根因", ctx.groupRoot.count);
  if (isQuietUpdate(ev, ctx.previous)) return downgrade(route, "同一事件更新, 未升级");
  if (ctx.recentSame && ctx.recentSame > 0) return downgrade(route, "短时间同类合并", ctx.recentSame);
  return route;
}

export function aggregateWindowSec(sets: RuleSets, ruleId: string | undefined): number {
  const rule = [...sets.user, ...sets.source].find((r) => r.id === ruleId);
  return rule?.aggregateSec ?? DEFAULT_AGGREGATE_SEC;
}
