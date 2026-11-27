import { API_V1 } from "./constants";
import type { Envelope } from "./event";
import type { FeedTag } from "./feed-tags";
import type { ChatView } from "./mail";

// 云 Agent 的 skill 与版本 (docs/design/agent-skill.md): 知识在 Git 里装一次, 机制在命令行, 服务端只管数据
// 版本号 "大.小": 小号变只换 skill 文本, 命令行自己从 Git 重装; 大号变 (或接入版本变) 要主人重发接入语

export const CORE_SKILL = "hx-aioa";
// 必须和 skills/hx-aioa/manifest.json 的 version 一致 (check:plugins 校验)
export const CORE_SKILL_VERSION = "1.1";
// 命令行 -> 服务端, 每个请求都带: setup=1,hx-aioa@1.0,hengxin666.todo@1.0
export const HEADER_SKILL = "X-Aioa-Skill";
// 服务端 -> 命令行, 群 Agent 的每个响应都带: setup=1,hx-aioa@1.0,hengxin666.todo@1.0[,auto]
export const HEADER_SKILL_WANT = "X-Aioa-Want";
export const PATH_AGENT_NEXT = `${API_V1}/chat-agent/next`;
export const PATH_AGENT_DONE = `${API_V1}/chat-agent/done`;
export const PATH_AGENT_TRIGGER = `${API_V1}/chat-agent/trigger`;
// 默认从这里拉 skill; 命令行用 HXAIOA_GIT_BASE 换掉前缀 (镜像)
export const SKILL_GIT_BASE = "https://raw.githubusercontent.com";
export const SKILL_REPO = "HengXin666/HX-AIOA";
export const SKILL_REF = "main";
// 上一个大版本的兼容期; 剩这么多天时群里再提醒一次
export const MAJOR_COMPAT_DAYS = 14;
export const MAJOR_REMIND_DAYS = 3;
// 游标之后已处理的零散 seq 最多记这么多, 超出时把游标推到其中最小的连续段
export const HANDLED_SET_MAX = 64;
export const NEXT_LIMIT = 30;
export const AGENT_TRIGGER_MAX = 120;

export type SkillReport = { setup: number; skills: Record<string, string>; auto?: boolean };
export type SkillGap = "same" | "minor" | "major";
// 触发方式: expr 是 Agent 原样上报的定时表达式, every 是服务端能看懂时推算的间隔秒数, tz 是 Agent 宿主的 IANA 时区 (cron 按它算)
export type AgentTrigger = { expr: string; every?: number; at: number; tz?: string };
// 插件清单 agent.changes 的一项: 某个大版本改了什么, 不升级会少什么, 旧版兼容到哪天
export type MajorChange = { version: string; changes: string; missing: string; until?: string };
export type SkillSource = { id: string; version: string; url: string };
export type AgentBrief = {
  version: string;
  name: string;
  channel: string;
  title: string;
  reads: string[];
  view?: ChatView;
  feedTags?: FeedTag[];
  plugin?: { id: string; version: string };
  skills: SkillSource[];
  want: SkillReport;
  missing: MajorChange[];
  trigger?: AgentTrigger;
};
// GET next?brief=<本地简报版本>&start=1&memory=1: 游标之后没处理的人发消息, 简报只在版本不同时带全文
// mentioned: 这条消息 @ 了本 Agent 或全体 (#131)
export type AgentPending = Envelope & { mentioned?: true };
export type AgentNext = { pending: AgentPending[]; head: number; cursor: number; briefVersion: string; brief?: AgentBrief; memory?: string };
// POST done 与 POST /messages 的 covers: 把这些 seq 记为已处理
export type AgentDoneInput = { seqs: number[] };
export type AgentDoneResult = { cursor: number; left: number };
export type AgentTriggerInput = { expr: string; tz?: string };

const VER = /^(\d+)\.(\d+)$/;

export function parseSkillVer(s: string | undefined): { major: number; minor: number } | null {
  const m = VER.exec(s ?? "");
  return m ? { major: Number(m[1]), minor: Number(m[2]) } : null;
}

export function formatSkillHeader(r: SkillReport): string {
  const parts = [`setup=${r.setup}`, ...Object.entries(r.skills).map(([id, v]) => `${id}@${v}`)];
  if (r.auto) parts.push("auto");
  return parts.join(",");
}

export function parseSkillHeader(v: string | null | undefined): SkillReport | null {
  if (!v) return null;
  const out: SkillReport = { setup: 0, skills: {} };
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

/** 已装的和应有的差多少: 接入版本或任一大号不同算 major, 只差小号算 minor。 */
export function skillGap(have: SkillReport | null, want: SkillReport): SkillGap {
  if (!have || have.setup !== want.setup) return "major";
  let gap: SkillGap = "same";
  for (const [id, w] of Object.entries(want.skills)) {
    const a = parseSkillVer(have.skills[id]);
    const b = parseSkillVer(w);
    if (!a || !b || a.major !== b.major) return "major";
    if (a.minor !== b.minor) gap = "minor";
  }
  return gap;
}
