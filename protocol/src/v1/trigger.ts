// 云 Agent 定时表达式的推算 (纯函数, 服务端, Web, 命令行共用; 安卓 ui/agents/Trigger.kt 是同一算法的移植)
// cron 按 Agent 宿主时区算, 宿主没上报时区时按调用方本地时区; 间隔写法以 lastRun (没有则 at) 为基准

export const TRIGGER_TZ_MAX = 64;
// 详情里最多列这么多个接下来的触发时间点
export const UPCOMING_MAX = 12;
// 迟到宽限的上限: 过了预计触发时间 + min(间隔, 30 分钟) 还没跑算迟到
export const LATE_GRACE_MAX_MS = 30 * 60_000;

const SEC_MS = 1000;
const MIN_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const CRON_FIELDS = 5;
// 找不到的表达式 (如 2 月 30 日) 最多往后找这么多步, 每步至少跳过一分钟
const SEARCH_STEPS = 200_000;
const SEARCH_SPAN_MS = 8 * 366 * DAY_MS;
const COUNT_MAX = 1000;
const STAR = "*";

const UNIT: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86_400, 秒: 1, 分: 60, 分钟: 60, 时: 3600, 小时: 3600, 天: 86_400 };
const NUM = /^\d+$/;
const pos = (n: number) => (Number.isFinite(n) && n > 0 ? n : undefined);

export type CronSpec = { minute: Set<number>; hour: Set<number>; dom: Set<number>; month: Set<number>; dow: Set<number>; domStar: boolean; dowStar: boolean };
export type ParsedTrigger = { kind: "every"; every: number } | { kind: "cron"; cron: CronSpec };

/** 非 cron 的间隔写法推算秒数: every 2h, 每 2 小时, 纯数字秒; 看不懂返回 undefined。 */
export function parseInterval(expr: string): number | undefined {
  const t = expr.trim();
  if (NUM.test(t)) return pos(Number(t));
  const en = /^every\s+(\d+)\s*([smhd])[a-z]*$/i.exec(t);
  if (en) return pos(Number(en[1]) * (UNIT[(en[2] ?? "").toLowerCase()] ?? 0));
  const zh = /^每\s*(\d*)\s*(秒|分钟|分|小时|时|天)$/.exec(t);
  if (zh) return pos((zh[1] ? Number(zh[1]) : 1) * (UNIT[zh[2] ?? ""] ?? 0));
  return undefined;
}

// 一段: *, */n, a, a-b, a-b/n, 用逗号连成列表; 越界或写错返回 null
function field(src: string, lo: number, hi: number): Set<number> | null {
  const out = new Set<number>();
  for (const part of src.split(",")) {
    const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
    if (!m) return null;
    const step = m[4] === undefined ? 1 : Number(m[4]);
    const ranged = m[3] !== undefined;
    if (m[4] !== undefined && m[1] !== STAR && !ranged) return null;
    const a = m[1] === STAR ? lo : Number(m[2]);
    const b = m[1] === STAR ? hi : ranged ? Number(m[3]) : a;
    if (step < 1 || a < lo || b > hi || a > b) return null;
    for (let v = a; v <= b; v += step) out.add(v);
  }
  return out;
}

export function parseCron(expr: string): CronSpec | null {
  const f = expr.trim().split(/\s+/);
  if (f.length !== CRON_FIELDS) return null;
  const [mi = "", ho = "", dm = "", mo = "", dw = ""] = f;
  const minute = field(mi, 0, 59);
  const hour = field(ho, 0, 23);
  const dom = field(dm, 1, 31);
  const month = field(mo, 1, 12);
  const dow0 = field(dw, 0, 7);
  if (!minute || !hour || !dom || !month || !dow0) return null;
  const dow = new Set([...dow0].map((d) => d % 7));
  // 与 Vixie cron 一致: 以 * 开头的日或星期算 "没限定"
  return { minute, hour, dom, month, dow, domStar: dm.startsWith(STAR), dowStar: dw.startsWith(STAR) };
}

/** 5 段 cron 优先, 否则按间隔写法; 都不是返回 null。 */
export function parseTrigger(expr: string): ParsedTrigger | null {
  if (expr.trim().split(/\s+/).length === CRON_FIELDS) {
    const cron = parseCron(expr);
    return cron ? { kind: "cron", cron } : null;
  }
  const every = parseInterval(expr);
  return every ? { kind: "every", every } : null;
}

export function isTimeZone(tz: string): boolean {
  if (!tz || tz.length > TRIGGER_TZ_MAX) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const localTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

const FORMATS = new Map<string, Intl.DateTimeFormat>();

// 某时刻在 tz 的墙上时间, 用 "当作 UTC 的毫秒" 表示 (精确到秒)
function wallOf(ms: number, tz: string): number {
  let f = FORMATS.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
    FORMATS.set(tz, f);
  }
  const p: Record<string, number> = {};
  for (const x of f.formatToParts(ms)) if (x.type !== "literal") p[x.type] = Number(x.value);
  return Date.UTC(p.year ?? 0, (p.month ?? 1) - 1, p.day ?? 1, p.hour ?? 0, p.minute ?? 0, p.second ?? 0);
}

// 墙上时间换回时刻; 夏令时跳过的时间不存在返回 null, 重叠的取较早的那个
function fromWall(wall: number, tz: string): number | null {
  const off1 = wallOf(wall, tz) - wall;
  const off2 = wallOf(wall - off1, tz) - (wall - off1);
  for (const off of off1 === off2 ? [off1] : [Math.max(off1, off2), Math.min(off1, off2)]) {
    if (wallOf(wall - off, tz) === wall) return wall - off;
  }
  return null;
}

function dayMatch(c: CronSpec, d: Date): boolean {
  const byDom = c.dom.has(d.getUTCDate());
  const byDow = c.dow.has(d.getUTCDay());
  if (c.domStar && c.dowStar) return true;
  if (c.domStar) return byDow;
  if (c.dowStar) return byDom;
  return byDom || byDow;
}

// 墙上时间 wall 之后 (不含) 第一个匹配的墙上分钟
function nextWall(c: CronSpec, wall: number, limit: number): number | null {
  let t = Math.floor(wall / MIN_MS) * MIN_MS + MIN_MS;
  for (let i = 0; i < SEARCH_STEPS && t <= limit; i++) {
    const d = new Date(t);
    const y = d.getUTCFullYear();
    const mo = d.getUTCMonth();
    const day = d.getUTCDate();
    const h = d.getUTCHours();
    if (!c.month.has(mo + 1)) t = Date.UTC(y, mo + 1, 1);
    else if (!dayMatch(c, d)) t = Date.UTC(y, mo, day + 1);
    else if (!c.hour.has(h)) t = Date.UTC(y, mo, day, h + 1);
    else if (!c.minute.has(d.getUTCMinutes())) t += MIN_MS;
    else return t;
  }
  return null;
}

function cronRuns(c: CronSpec, from: number, count: number, tz: string): number[] {
  const out: number[] = [];
  let wall = wallOf(from, tz);
  const limit = wall + SEARCH_SPAN_MS;
  while (out.length < count) {
    const w = nextWall(c, wall, limit);
    if (w === null) break;
    wall = w;
    const at = fromWall(w, tz);
    if (at !== null && at > from && at > (out.at(-1) ?? -Infinity)) out.push(at);
  }
  return out;
}

/**
 * from 之后 (不含) 的 count 个触发时刻 (毫秒)。
 * cron 按 tz (缺省或无效时为本地时区) 算; 间隔写法取 base + k * 间隔 (k >= 1), base 缺省为 from。
 * 无法解析返回空。
 */
export function nextRuns(expr: string, from: number, count: number, tz?: string, base = from): number[] {
  const p = parseTrigger(expr);
  const n = Math.min(Math.max(0, Math.floor(count)), COUNT_MAX);
  if (!p || !n) return [];
  if (p.kind === "cron") return cronRuns(p.cron, from, n, tz && isTimeZone(tz) ? tz : localTimeZone());
  const e = p.every * SEC_MS;
  const k = Math.max(1, Math.floor((from - base) / e) + 1);
  return Array.from({ length: n }, (_, i) => base + (k + i) * e);
}

/** tz 里 ms 所在那天 0 点之后第 days 天的 0 点 (时刻)。 */
export function dayStartAfter(ms: number, days: number, tz: string): number {
  const w = new Date(wallOf(ms, tz));
  const target = Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate() + days);
  // 0 点被夏令时跳过时往后找第一个存在的整点
  for (let t = target; t < target + DAY_MS; t += HOUR_MS) {
    const at = fromWall(t, tz);
    if (at !== null) return at;
  }
  return target - (wallOf(target, tz) - target);
}

export type TriggerView = {
  parsed: boolean;
  /** now 之后的下一次 */
  next?: number;
  /** 详情列表: 今天和明天 (viewTz) 的全部, 最多 12 个; 一个都没有时只放下一次 */
  upcoming: number[];
  /** 按 lastRun (没有则 at) 推出的应触发时刻, 迟到判断用 */
  expected?: number;
  late: boolean;
  tz: string;
};

export type TriggerLike = { expr: string; at: number; tz?: string };

/** 卡片与详情要的全部: 只算不发请求。viewTz 是 "今天和明天" 的日界, 缺省为本地时区。 */
export function triggerView(t: TriggerLike, lastRun: number | undefined, now: number, viewTz?: string): TriggerView {
  const tz = t.tz && isTimeZone(t.tz) ? t.tz : localTimeZone();
  const base = lastRun ?? t.at;
  if (!parseTrigger(t.expr)) return { parsed: false, upcoming: [], late: false, tz };
  const ahead = nextRuns(t.expr, now, UPCOMING_MAX, tz, base);
  const end = dayStartAfter(now, 2, viewTz && isTimeZone(viewTz) ? viewTz : localTimeZone());
  const today = ahead.filter((x) => x < end);
  const [expected, after] = nextRuns(t.expr, base, 2, tz, base);
  const gap = expected !== undefined && after !== undefined ? after - expected : LATE_GRACE_MAX_MS;
  const late = expected !== undefined && now > expected + Math.min(gap, LATE_GRACE_MAX_MS);
  return { parsed: true, next: ahead[0], upcoming: today.length ? today : ahead.slice(0, 1), expected, late, tz };
}
