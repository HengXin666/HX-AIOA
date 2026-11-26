import {
  CORE_SKILL,
  CORE_SKILL_VERSION,
  HEADER_SKILL,
  MAJOR_COMPAT_DAYS,
  MAJOR_REMIND_DAYS,
  OFFICIAL_SOURCE,
  SKILL_GIT_BASE,
  SKILL_REF,
  SKILL_REPO,
  feedTagsOf,
  formatSkillHeader,
  parseSkillHeader,
  parseSkillVer,
  skillGap,
  type AgentBrief,
  type ChatAgent,
  type ChatMeta,
  type MajorChange,
  type SkillReport,
  type SkillSource,
} from "@hx-aioa/protocol";
import { fnv } from "./agent-prompt";
import { notice } from "./agent-sync";
import { saveAgents } from "./api-chats";
import { DAY_MS } from "./constants";
import type { Core } from "./core";

// 应有版本, 简报, 大更新提醒: 全部现算, 只在 Agent 资料真的变了时写一次
const RAW = `${SKILL_GIT_BASE}/${SKILL_REPO}/${SKILL_REF}`;
const CORE_URL = `${RAW}/skills/${CORE_SKILL}/`;
const SKILL_DIR = "skill/";
// 兼容截止日按东八区的那天结束
const TZ_MS = 8 * 3600_000;
const END_OF_DAY = "T23:59:59+08:00";
const WARN_NEW = ":new";
const WARN_REMIND = ":remind";
const CORE_CHANGE = { changes: "核心 skill 大版本更新", missing: "新功能用不上, 兼容期过后本群停止处理" };

export type Missing = MajorChange & { key: string; until: string };
type PluginSkill = { id: string; version: string; url: string; changes: MajorChange[] };

/** 第三方源的插件从该源目录拉, 官方与内置插件从仓库拉。 */
function skillUrl(core: Core, id: string, source?: string): string {
  const src = source && source !== OFFICIAL_SOURCE ? core.market.sources().find((s) => s.id === source) : undefined;
  return src ? `${src.url}/${id}/${SKILL_DIR}` : `${RAW}/plugins/${id}/${SKILL_DIR}`;
}

/** 已装插件的 skill: 安装时记下的为准; 老安装记录只在白名单版本与已装一致时用白名单清单; 开发插件不在 Git 里, 不算。 */
export function pluginSkill(core: Core, id: string): PluginSkill | null {
  const rec = core.plugins.get(id);
  const row = core.kernel.get(id);
  if (!rec || row?.meta.dev) return null;
  const job = core.plugins.job(id);
  const same = row?.meta.version === rec.version ? row.manifest.agent : undefined;
  const version = job?.skill ?? same?.skill;
  if (!version || !parseSkillVer(version)) return null;
  return { id, version, url: skillUrl(core, id, row?.meta.source), changes: job?.changes ?? same?.changes ?? [] };
}

export function wantOf(core: Core, agent: ChatAgent): SkillReport {
  const p = agent.plugin ? pluginSkill(core, agent.plugin) : null;
  return { setup: agent.setup ?? 1, skills: { [CORE_SKILL]: CORE_SKILL_VERSION, ...(p ? { [p.id]: p.version } : {}) }, ...(agent.autoMajor ? { auto: true } : {}) };
}

const dayOf = (ms: number) => new Date(ms + TZ_MS).toISOString().slice(0, 10);
const endOf = (day: string) => Date.parse(`${day}${END_OF_DAY}`);
export const daysLeft = (m: Missing, now: number) => Math.ceil((endOf(m.until) - now) / DAY_MS);

/** 已装的比应有的少了哪些大版本 (只看 skill, 接入版本变化是主人自己拨的开关, 不在群里提醒)。 */
export function missingOf(core: Core, agent: ChatAgent, have: SkillReport | null | undefined, now = Date.now()): Missing[] {
  if (!have) return [];
  const out: Missing[] = [];
  for (const [id, v] of Object.entries(wantOf(core, agent).skills)) {
    const want = parseSkillVer(v);
    if (!want || parseSkillVer(have.skills[id])?.major === want.major) continue;
    const list = id === CORE_SKILL ? [] : (pluginSkill(core, id)?.changes ?? []);
    const ch = list.find((c) => parseSkillVer(c.version)?.major === want.major);
    const key = `${id}@${want.major}`;
    const until = ch?.until ?? dayOf(core.plugins.majorSince(key, now) + MAJOR_COMPAT_DAYS * DAY_MS);
    out.push({ key, version: v, changes: ch?.changes ?? CORE_CHANGE.changes, missing: ch?.missing ?? CORE_CHANGE.missing, until });
  }
  return out;
}

export function expiredOf(core: Core, agent: ChatAgent, have: SkillReport | null | undefined, now = Date.now()): Missing | undefined {
  return missingOf(core, agent, have, now).find((m) => now > endOf(m.until));
}

/** 简报: 版本是去掉 version 之后内容的 FNV, 命令行本地版本相同就不再带全文。 */
export function briefOf(core: Core, meta: ChatMeta, agent: ChatAgent, have: SkillReport | null | undefined, now = Date.now()): AgentBrief {
  const p = agent.plugin ? pluginSkill(core, agent.plugin) : null;
  const rec = agent.plugin ? core.plugins.get(agent.plugin) : null;
  const skills: SkillSource[] = [{ id: CORE_SKILL, version: CORE_SKILL_VERSION, url: CORE_URL }, ...(p ? [{ id: p.id, version: p.version, url: p.url }] : [])];
  const body: Omit<AgentBrief, "version"> = {
    name: agent.name,
    channel: meta.channel,
    title: meta.title || meta.channel,
    reads: agent.reads,
    ...(meta.view ? { view: meta.view } : {}),
    ...(meta.view === "feed" ? { feedTags: feedTagsOf(meta).tags } : {}),
    ...(rec ? { plugin: { id: rec.id, version: rec.version } } : {}),
    skills,
    want: wantOf(core, agent),
    missing: missingOf(core, agent, have, now).map(({ key: _k, ...m }) => m),
    ...(agent.trigger ? { trigger: agent.trigger } : {}),
  };
  return { version: fnv(JSON.stringify(body)), ...body };
}

/** 改一个 Agent: 每次都按最新的群资料改, 不用调用方手里可能已旧的副本。 */
export function putAgent(core: Core, channel: string, keyId: string, fn: (a: ChatAgent) => ChatAgent): ChatAgent | null {
  const agents = core.chats.chat(channel)?.agents ?? [];
  const old = agents.find((a) => a.keyId === keyId);
  if (!old) return null;
  const next = fn(old);
  if (next !== old) saveAgents(core, channel, agents.map((a) => (a.keyId === keyId ? next : a)));
  return next;
}

function warnText(name: string, m: Missing, left?: number): string {
  const head = left === undefined ? `${name} 需要重新接入: 缺 ${m.version} 大版本` : `${name} 还缺 ${m.version} 大版本, 兼容期只剩 ${left} 天`;
  return `${head}。改了什么: ${m.changes}; 不升级会少: ${m.missing}; 旧版兼容到 ${m.until}。在 App 的 Agent 卡片里复制新接入语发给它。`;
}

/**
 * Agent 的每个请求: 解析 X-Aioa-Skill, 只在已装版本变化时写; 新出现的大版本缺失在群里提醒一次。
 * 返回 X-Aioa-Want 的值。
 */
export async function noteSkill(core: Core, req: Request, meta: ChatMeta, agent: ChatAgent, now = Date.now()): Promise<string> {
  const want = wantOf(core, agent);
  const have = parseSkillHeader(req.headers.get(HEADER_SKILL));
  if (!have) return formatSkillHeader(want);
  const changed = !agent.skills || formatSkillHeader(agent.skills) !== formatSkillHeader(have);
  const warned = agent.warned ?? [];
  const fresh = skillGap(have, want) === "major" ? missingOf(core, agent, have, now).filter((m) => !warned.includes(m.key + WARN_NEW)) : [];
  if (changed || fresh.length) {
    putAgent(core, meta.channel, agent.keyId, (a) => ({ ...a, skills: have, ...(fresh.length ? { warned: [...(a.warned ?? []), ...fresh.map((m) => m.key + WARN_NEW)] } : {}) }));
  }
  for (const m of fresh) await notice(core, meta.channel, warnText(agent.name, m));
  return formatSkillHeader(want);
}

/** 每天的 cron: 兼容期剩 MAJOR_REMIND_DAYS 天以内且还没过期的再提醒一次。 */
export async function majorRemind(core: Core, now = Date.now()): Promise<number> {
  let sent = 0;
  for (const meta of core.chats.chats()) {
    for (const agent of meta.agents ?? []) {
      const warned = agent.warned ?? [];
      const due = missingOf(core, agent, agent.skills, now).filter((m) => {
        const left = daysLeft(m, now);
        return left > 0 && left <= MAJOR_REMIND_DAYS && !warned.includes(m.key + WARN_REMIND);
      });
      if (!due.length) continue;
      putAgent(core, meta.channel, agent.keyId, (a) => ({ ...a, warned: [...(a.warned ?? []), ...due.map((m) => m.key + WARN_REMIND)] }));
      for (const m of due) await notice(core, meta.channel, warnText(agent.name, m, daysLeft(m, now)));
      sent += due.length;
    }
  }
  return sent;
}

/** 插件更新安装时 skill 大号变了: 用这个插件的 Agent 接入版本加 1, 主人要重发接入语。 */
export function bumpSetup(core: Core, plugin: string, before?: string, after?: string): void {
  const a = parseSkillVer(before);
  const b = parseSkillVer(after);
  if (!a || !b || a.major === b.major) return;
  for (const meta of core.chats.chats()) {
    for (const agent of meta.agents ?? []) {
      if (agent.plugin === plugin) putAgent(core, meta.channel, agent.keyId, (x) => ({ ...x, setup: (x.setup ?? 1) + 1 }));
    }
  }
}
