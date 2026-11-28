// 审批卡片 (四问 + 风险档) 与实时统计 (上下文, tok/s, 缓存命中)
import path from "node:path";
import { CARD_TOOL_MAX, RISK_ORDER, STATS_MS } from "./probe-agent-const.mjs";

const GOAL_LINES = 2;
const LAST_LINES = 3;
const DIFF_HUNKS = 2;
const GAP_MS = 1500;
const TPS_WINDOW_MS = 4000;
const CALIB_MIN_TOK = 50;
const CALIB_RANGE = [0.2, 5];
const CJK = /[\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/g;

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const lastLines = (s, n) => s.trim().split("\n").filter((l) => l.trim()).slice(-n).join("\n");
const firstLines = (s, n) => s.trim().split("\n").filter((l) => l.trim()).slice(0, n).join("\n");

export function promptText(blocks) {
  if (!Array.isArray(blocks)) return "";
  return blocks.map((b) => (b?.type === "text" ? b.text : b?.type === "resource_link" ? `@${b.name ?? b.uri}` : "")).filter(Boolean).join("\n");
}

// 简易行 diff: 只给前两段, 卡片上看个大概
function miniDiff(c) {
  const a = (c.oldText ?? "").split("\n");
  const b = (c.newText ?? "").split("\n");
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length - 1;
  let eb = b.length - 1;
  while (ea >= s && eb >= s && a[ea] === b[eb]) {
    ea--;
    eb--;
  }
  const out = [`--- ${c.path}`, `@@ ${s + 1} @@`];
  for (const l of a.slice(s, ea + 1)) out.push(`-${l}`);
  for (const l of b.slice(s, eb + 1)) out.push(`+${l}`);
  return out.slice(0, 2 + DIFF_HUNKS * 20).join("\n");
}

function contentText(tool) {
  const parts = [];
  const raw = tool.rawInput;
  if (raw && typeof raw === "object") {
    if (typeof raw.command === "string") parts.push(raw.command);
    else if (Array.isArray(raw.command)) parts.push(raw.command.join(" "));
    if (typeof raw.url === "string") parts.push(raw.url);
  }
  for (const c of tool.content ?? []) {
    if (c?.type === "diff") parts.push(miniDiff(c));
    else if (c?.type === "content" && c.content?.type === "text") parts.push(c.content.text);
    else if (c?.type === "terminal") parts.push(`[终端 ${c.terminalId}]`);
  }
  return clip(parts.join("\n"), CARD_TOOL_MAX);
}

export function risk(rules, tool, cwd) {
  const text = [tool.title, tool.content, ...tool.locations].join("\n");
  let level = 0;
  const why = [];
  const editing = tool.kind === "edit" || tool.kind === "delete" || tool.kind === "move";
  for (const r of rules?.rules ?? []) {
    let hit = false;
    if (r.kind && r.kind === tool.kind) hit = true;
    if (r.match) {
      try {
        if (new RegExp(r.match, "i").test(text)) hit = true;
      } catch {}
    }
    if (r.outside && editing) hit = tool.locations.some((p) => path.isAbsolute(p) && p !== cwd && !p.startsWith(cwd + path.sep)) || hit;
    if (!hit) continue;
    const lv = Math.max(0, RISK_ORDER.indexOf(r.level));
    level = Math.max(level, lv);
    if (r.why && !why.includes(r.why)) why.push(r.why);
  }
  return { risk: RISK_ORDER[level], why };
}

export function buildCard({ host, sess, rid, params, tool, turn, rules, branch }) {
  const merged = { ...(tool ?? {}), ...(params.toolCall ?? {}) };
  if (!merged.content?.length && tool?.content) merged.content = tool.content;
  const t = {
    kind: merged.kind ?? "other",
    title: merged.title ?? "",
    content: contentText(merged),
    locations: (merged.locations ?? []).map((l) => l?.path).filter(Boolean),
  };
  const r = risk(rules, t, sess.cwd);
  const card = {
    rid,
    sid: sess.id,
    host,
    agent: sess.agent,
    title: sess.title,
    cwd: sess.cwd,
    at: Date.now(),
    tool: t,
    goal: firstLines(turn?.goal ?? "", GOAL_LINES),
    last: lastLines(turn?.last ?? "", LAST_LINES),
    risk: r.risk,
    why: r.why,
    changed: turn?.changed?.size ?? 0,
    options: (params.options ?? []).map((o) => ({ optionId: o.optionId, kind: o.kind, name: o.name })),
  };
  if (branch) card.branch = branch;
  return card;
}

export function estTokens(text) {
  const cjk = (text.match(CJK) ?? []).length;
  return cjk + (text.length - cjk) / 4;
}

// tok/s 只计活跃输出时间; 轮末用 outputTokens 校准估算系数 (按 实例/模型 记)
export class Stats {
  constructor(calib, keyFn) {
    this.calib = calib;
    this.keyFn = keyFn;
    this.ctx = undefined;
    this.cost = undefined;
    this.tps = 0;
    this.est = true;
    this.last = {};
    this.recent = [];
    this.resetTurn();
  }

  resetTurn() {
    this.turnRaw = 0;
    this.turnActive = 0;
    this.lastAt = 0;
    this.turnStart = Date.now();
    this.recent = [];
  }

  factor() {
    return this.calib[this.keyFn()] ?? 1;
  }

  chunk(text) {
    const now = Date.now();
    const raw = estTokens(text);
    this.turnRaw += raw;
    if (this.lastAt && now - this.lastAt < GAP_MS) this.turnActive += now - this.lastAt;
    this.recent.push({ at: now, tok: raw, gap: this.lastAt && now - this.lastAt < GAP_MS ? now - this.lastAt : 0 });
    this.lastAt = now;
    while (this.recent.length && now - this.recent[0].at > TPS_WINDOW_MS) this.recent.shift();
    const tok = this.recent.reduce((a, r) => a + r.tok, 0) * this.factor();
    const ms = this.recent.reduce((a, r) => a + r.gap, 0);
    if (ms > 200) {
      this.tps = Math.round(tok / (ms / 1000));
      this.est = true;
    }
  }

  usage(u) {
    if (typeof u.used === "number" && typeof u.size === "number") this.ctx = [u.used, u.size];
    if (u.cost && typeof u.cost.amount === "number") this.cost = u.cost.amount;
  }

  // 轮末: 返回是否更新了校准系数
  endTurn(usage) {
    const ms = Date.now() - this.turnStart;
    let calibrated = false;
    if (usage && typeof usage.outputTokens === "number") {
      const input = usage.inputTokens ?? 0;
      const cr = usage.cachedReadTokens ?? 0;
      const cw = usage.cachedWriteTokens ?? 0;
      this.last = { in: input, out: usage.outputTokens, cr, cw, ms };
      if (input + cr + cw > 0) this.last.hit = Math.round((cr / (input + cr + cw)) * 100) / 100;
      if (this.turnRaw >= CALIB_MIN_TOK) {
        const f = Math.min(CALIB_RANGE[1], Math.max(CALIB_RANGE[0], usage.outputTokens / this.turnRaw));
        const key = this.keyFn();
        const old = this.calib[key];
        this.calib[key] = Math.round((old ? (old + f) / 2 : f) * 1000) / 1000;
        calibrated = true;
      }
      if (this.turnActive > 200) {
        this.tps = Math.round(usage.outputTokens / (this.turnActive / 1000));
        this.est = false;
      }
    } else {
      this.last = { ...this.last, ms };
    }
    this.lastAt = 0;
    this.recent = [];
    return calibrated;
  }

  frame(sid) {
    const f = { t: "stats", sid, tps: this.tps, est: this.est };
    if (this.ctx) f.ctx = this.ctx;
    if (this.cost !== undefined) f.cost = this.cost;
    if (this.last.hit !== undefined) f.hit = this.last.hit;
    for (const k of ["in", "out", "cr", "cw", "ms"]) if (this.last[k] !== undefined) f[k] = this.last[k];
    return f;
  }
}

export const STATS_INTERVAL = STATS_MS;
