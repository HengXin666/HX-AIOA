// 协议常量与版本算法的命令行副本: 命令行是 .mjs 不能直接 import ts
// 来源 protocol/src/v1/agent-skill.ts 与 plugin-todo.ts, 改协议时两边一起改
export const API = "/api/v1";
export const CORE_SKILL = "hx-aioa";
export const HEADER_SKILL = "X-Aioa-Skill";
export const HEADER_SKILL_WANT = "X-Aioa-Want";
export const PATH_AGENT_NEXT = `${API}/chat-agent/next`;
export const PATH_AGENT_DONE = `${API}/chat-agent/done`;
export const PATH_AGENT_TRIGGER = `${API}/chat-agent/trigger`;
export const PATH_AGENT_ME = `${API}/chat-agent/me`;
// 来源 protocol/src/v1/trigger.ts
export const TRIGGER_TZ_MAX = 64;
export const PATH_MESSAGES = `${API}/messages`;
export const SKILL_GIT_BASE = "https://raw.githubusercontent.com";
export const TODO_PLUGIN = "hengxin666.todo";
export const TODO_COLL = "items";
export const PATH_TODO_ITEMS = `${API}/pdata/${TODO_PLUGIN}/${TODO_COLL}`;
export const todoRowId = (channel, id) => `${channel}:${id}`;

const VER = /^(\d+)\.(\d+)$/;

export function parseSkillVer(s) {
  const m = VER.exec(s ?? "");
  return m ? { major: Number(m[1]), minor: Number(m[2]) } : null;
}

export function formatSkillHeader(r) {
  const parts = [`setup=${r.setup}`, ...Object.entries(r.skills).map(([id, v]) => `${id}@${v}`)];
  if (r.auto) parts.push("auto");
  return parts.join(",");
}

export function parseSkillHeader(v) {
  if (!v) return null;
  const out = { setup: 0, skills: {} };
  for (const raw of v.split(",")) {
    const p = raw.trim();
    if (p === "auto") out.auto = true;
    else if (p.startsWith("setup=")) out.setup = Number.parseInt(p.slice(6), 10) || 0;
    else {
      const at = p.lastIndexOf("@");
      if (at > 0 && parseSkillVer(p.slice(at + 1))) out.skills[p.slice(0, at)] = p.slice(at + 1);
    }
  }
  return out;
}

/** 宿主的 IANA 时区, 随 me --trigger 上报 (cron 按它推算); 拿不到或太长返回 undefined。 */
export function hostTimeZone() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && tz.length <= TRIGGER_TZ_MAX ? tz : undefined;
  } catch {
    return undefined;
  }
}

/** 已装的和应有的差多少: 接入版本或任一大号不同算 major, 只差小号算 minor。 */
export function skillGap(have, want) {
  if (!have || have.setup !== want.setup) return "major";
  let gap = "same";
  for (const [id, w] of Object.entries(want.skills)) {
    const a = parseSkillVer(have.skills?.[id]);
    const b = parseSkillVer(w);
    if (!a || !b || a.major !== b.major) return "major";
    if (a.minor !== b.minor) gap = "minor";
  }
  return gap;
}

/** major 时缺的是哪些: 接入版本不同写 "接入 N", 大号不同写 "<id>@<应有>"。 */
export function missingMajors(have, want) {
  const out = [];
  if (!have || have.setup !== want.setup) out.push(`接入 ${want.setup}`);
  for (const [id, w] of Object.entries(want.skills)) {
    const a = parseSkillVer(have?.skills?.[id]);
    const b = parseSkillVer(w);
    if (!a || !b || a.major !== b.major) out.push(`${id}@${w}`);
  }
  return out;
}
