import type { TimeWindow } from "@hx-aioa/protocol";

const MINUTES_PER_HOUR = 60;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" });
    formatters.set(tz, f);
  }
  return f;
}

export function isValidTz(tz: string): boolean {
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

// 返回当地的分钟数 (0-1439) 与是否周末
export function localClock(now: number, tz: string): { minutes: number; weekend: boolean } {
  const parts = formatter(tz).formatToParts(new Date(now));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const minutes = Number(get("hour")) * MINUTES_PER_HOUR + Number(get("minute"));
  const day = get("weekday");
  return { minutes, weekend: day === "Sat" || day === "Sun" };
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":");
  return Number(h) * MINUTES_PER_HOUR + Number(m);
};

// start > end 表示跨午夜, 此时 "周几" 以开始那天为准
export function inWindow(w: TimeWindow | undefined, now: number, tz: string): boolean {
  if (!w) return true;
  const { minutes, weekend } = localClock(now, tz);
  const start = w.start ? toMinutes(w.start) : 0;
  const end = w.end ? toMinutes(w.end) : 24 * MINUTES_PER_HOUR;
  const overnight = start > end;
  const inTime = overnight ? minutes >= start || minutes < end : minutes >= start && minutes < end;
  if (!inTime) return false;
  if (!w.days || w.days === "all") return true;
  let isWeekend = weekend;
  if (overnight && minutes < end) isWeekend = localClock(now - (minutes + 1) * 60_000, tz).weekend;
  return w.days === "weekend" ? isWeekend : !isWeekend;
}
