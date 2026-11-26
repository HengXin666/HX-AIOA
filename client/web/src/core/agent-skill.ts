import {
  CORE_SKILL,
  CORE_SKILL_VERSION,
  MAJOR_COMPAT_DAYS,
  parseSkillVer,
  skillGap,
  type ChatAgent,
  type Envelope,
  type MajorChange,
  type PluginAgent,
  type SkillGap,
  type SkillReport,
} from "@hx-aioa/protocol";

// skill 版 Agent 的版本与运行状态 (docs/design/agent-skill.md "App"); 只读 ChatMeta 与本地事件, 不发请求

const DAY_MS = 86_400_000;
const SEC_MS = 1000;
const LATE_FACTOR = 2;
const DEFAULT_SETUP = 1;
const USER_SOURCE = "user:";
const STORAGE_SEEN = "aioa.skillSeen";

export type MissingMajor = { id: string; have?: string; want: string; changes: MajorChange[]; deadline: number };
export type SkillStatus = { gap: SkillGap; legacy: boolean; setupHave?: number; setupWant: number; missing: MissingMajor[] };
export type RunInfo = { next?: number; late: boolean };
// 插件清单的 agent 段里与 skill 有关的两项; Web 端目前没有插件清单, 传 undefined 时按 warned 推断
export type PluginSkill = Pick<PluginAgent, "skill" | "changes">;

/** 用过 skill 版接口的 Agent 才有这些字段; 旧指令 Agent 不显示 skill 区。 */
export const isSkillAgent = (a: ChatAgent) => Boolean(a.skills || a.setup || a.handled !== undefined || a.trigger || a.lastRun);

// warned 形如 "hengxin666.todo@2:new"; 只取比已装更高的大号
function warnedMajor(a: ChatAgent, id: string): number | undefined {
  const have = parseSkillVer(a.skills?.skills[id])?.major ?? 0;
  const majors = (a.warned ?? [])
    .map((w) => w.split(":")[0] ?? "")
    .filter((head) => head.slice(0, head.lastIndexOf("@")) === id)
    .map((head) => Number(head.slice(head.lastIndexOf("@") + 1)))
    .filter((m) => Number.isInteger(m) && m > have);
  return majors.length ? Math.max(...majors) : undefined;
}

/** 应有版本: { setup, skills: { hx-aioa: CORE, <插件 id>: agent.skill }, auto }。 */
export function wantOf(a: ChatAgent, plugin?: PluginSkill): SkillReport {
  const skills: Record<string, string> = { [CORE_SKILL]: CORE_SKILL_VERSION };
  if (a.plugin) {
    const major = warnedMajor(a, a.plugin);
    const v = parseSkillVer(plugin?.skill) ? plugin!.skill : major !== undefined ? `${major}.0` : undefined;
    if (v) skills[a.plugin] = v;
  }
  return { setup: a.setup ?? DEFAULT_SETUP, skills, auto: a.autoMajor };
}

// 本机第一次看到某个大版本缺失的时间; 清单没写 until 时兼容截止按它加 14 天
function firstSeen(key: string, now: number): number {
  let map: Record<string, number> = {};
  try {
    map = JSON.parse(localStorage.getItem(STORAGE_SEEN) ?? "{}") as Record<string, number>;
  } catch {
    map = {};
  }
  if (map[key]) return map[key];
  map[key] = now;
  localStorage.setItem(STORAGE_SEEN, JSON.stringify(map));
  return now;
}

export function skillStatus(a: ChatAgent, plugin: PluginSkill | undefined, now: number): SkillStatus {
  const want = wantOf(a, plugin);
  const have = a.skills ?? null;
  const gap = skillGap(have, want);
  const missing: MissingMajor[] = [];
  if (gap === "major") {
    for (const [id, w] of Object.entries(want.skills)) {
      const hv = have?.skills[id];
      const hm = parseSkillVer(hv)?.major ?? 0;
      const wm = parseSkillVer(w)?.major;
      if (wm === undefined || (hv && hm === wm)) continue;
      const changes = id === a.plugin ? (plugin?.changes ?? []).filter((c) => { const m = parseSkillVer(c.version)?.major ?? 0; return m > hm && m <= wm; }) : [];
      const untils = changes.map((c) => (c.until ? Date.parse(c.until) : NaN)).filter((t) => !Number.isNaN(t));
      const deadline = untils.length ? Math.min(...untils) : firstSeen(`${a.keyId}|${id}@${wm}`, now) + MAJOR_COMPAT_DAYS * DAY_MS;
      missing.push({ id, have: hv, want: w, changes, deadline });
    }
  }
  return { gap, legacy: !have, setupHave: have?.setup, setupWant: want.setup, missing };
}

/** 按 every 推算下次运行; 超过 2 倍间隔没跑算迟到。 */
export function runInfo(a: ChatAgent, now: number): RunInfo {
  const every = a.trigger?.every;
  if (!a.trigger || !every || every <= 0) return { late: false };
  const base = a.lastRun ?? a.trigger.at;
  return { next: base + every * SEC_MS, late: now - base > LATE_FACTOR * every * SEC_MS };
}

/** 本地已有消息里 seq > handled 且不在 handledSet 的人发消息条数; 不是 skill 版 Agent 为 undefined。 */
export function pendingCount(a: ChatAgent, channel: string, events: Iterable<Envelope>): number | undefined {
  if (a.handled === undefined) return undefined;
  const skip = new Set(a.handledSet ?? []);
  let n = 0;
  for (const ev of events) {
    if (ev.channel !== channel || ev.seq <= a.handled || skip.has(ev.seq) || ev.deleted) continue;
    if (ev.by || ev.source.id.startsWith(USER_SOURCE)) n++;
  }
  return n;
}
