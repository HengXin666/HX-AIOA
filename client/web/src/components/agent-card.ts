import { PATH_CHAT_AGENT, PATH_CHAT_AGENT_PROMPT, PATH_CHATS, type ChatAgent, type ChatMeta } from "@hx-aioa/protocol";
import { CLS } from "../constants";
import { api, json } from "../core/api";
import { agoText, button, h } from "../core/dom";
import { TOPIC_CHAT_SYNC, TOPIC_EVENTS } from "../core/store";
import { isSkillAgent, pendingCount, runInfo, skillStatus, type SkillStatus } from "../core/agent-skill";
import { keyedRegion, section, type Env } from "../pages/page";

// 群 Agent 卡片 (skill 版): 触发方式, 运行, 待处理, skill 状态, 大更新自动执行, 复制新接入语

const TXT_RELINK = "需重新接入";
const TXT_SWITCH_HINT = "触发语会变, 需要把新接入语发给 Agent 一次。";
const TXT_COPY = "复制新接入语";
const CLS_DANGER = "danger-text";
// 只是重算 "x 分钟前" 与迟到, 不发请求
const RENDER_TICK_MS = 60_000;
const fmtDay = new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
const fmtDate = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });

const agentPath = (tpl: string, channel: string, keyId: string) => tpl.replace("{channel}", encodeURIComponent(channel)).replace("{keyId}", encodeURIComponent(keyId));

const GAP_TEXT: Record<SkillStatus["gap"], string> = { same: "skill 最新", minor: "小更新待生效", major: TXT_RELINK };

function line(label: string, value: string, alert = false): HTMLElement {
  return h("div", { class: alert ? `${CLS.meta} ${CLS_DANGER}` : CLS.meta }, `${label}: ${value}`);
}

function majorList(s: SkillStatus): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (s.legacy) out.push(line("skill", `${TXT_RELINK}, 还没上报已装版本`, true));
  if (s.setupHave !== undefined && s.setupHave !== s.setupWant) out.push(line("接入版本", `${s.setupHave} -> ${s.setupWant}`));
  for (const m of s.missing) {
    out.push(line(m.id, `${m.have ?? "未装"} -> ${m.want} · 兼容到 ${fmtDate.format(m.deadline)}`, true));
    for (const c of m.changes) {
      out.push(h("div", { class: CLS.meta }, `${c.version}: ${c.changes}`));
      if (c.missing) out.push(h("div", { class: CLS.meta }, `不升级会少: ${c.missing}`));
    }
  }
  return out;
}

export function agentCard(meta: ChatMeta, a: ChatAgent, env: Env, reload: () => void): HTMLElement {
  const now = Date.now();
  const status = h("div", { class: CLS.meta });
  const title = h("div", { class: "ev-title" }, a.name);
  const sub = h("div", { class: CLS.meta }, `${meta.title ?? meta.channel}${a.active ? ` · ${agoText(a.active, now)}活跃` : ""}`);
  if (!isSkillAgent(a)) return h("div", { class: "card" }, title, sub, h("div", { class: CLS.meta }, "还没装 skill, 仍用旧的专属指令; 重新接入后改用 skill。"));
  const s = skillStatus(a, undefined, now);
  const run = runInfo(a, now);
  const pending = pendingCount(a, meta.channel, env.store.events.values());
  const chips = h(
    "div",
    { class: "row wrap" },
    h("span", { class: s.gap === "major" ? `chip ${CLS_DANGER}` : s.gap === "same" ? "chip on" : "chip" }, GAP_TEXT[s.gap]),
    pending ? h("span", { class: "chip" }, `待处理 ${pending}`) : null,
    run.late ? h("span", { class: `chip ${CLS_DANGER}` }, "定时未运行") : null,
  );
  const lines = [
    line("触发方式", a.trigger?.expr ?? "还没上报"),
    line("上次运行", a.lastRun ? `${fmtDay.format(a.lastRun)} (${agoText(a.lastRun, now)})` : "还没有"),
    run.next ? line("下次运行", `${fmtDay.format(run.next)}${run.late ? " · 超过 2 倍间隔没跑" : ""}`, run.late) : null,
    pending !== undefined ? line("待处理", `${pending} 条`) : null,
    s.gap === "minor" ? line("skill", "小更新待生效, Agent 下一轮自己重装") : null,
  ];
  const toggle = h("input", { type: "checkbox", checked: a.autoMajor === true });
  toggle.addEventListener("change", () => {
    const on = toggle.checked;
    if (!confirm(`${on ? "开启" : "关闭"}大更新自动执行? ${TXT_SWITCH_HINT}`)) return void (toggle.checked = !on);
    api(agentPath(PATH_CHAT_AGENT, meta.channel, a.keyId), json("PATCH", { autoMajor: on }))
      .then(() => ((status.textContent = TXT_SWITCH_HINT), reload()))
      .catch((e: Error) => ((toggle.checked = !on), (status.textContent = `没有保存: ${e.message}`)));
  });
  const copy = () =>
    api<{ prompt: string }>(agentPath(PATH_CHAT_AGENT_PROMPT, meta.channel, a.keyId))
      .then((r) => navigator.clipboard.writeText(r.prompt))
      .then(() => (status.textContent = "已复制新接入语, 发给 Agent 一次"))
      .catch((e: Error) => (status.textContent = `复制失败: ${e.message}`));
  return h(
    "div",
    { class: "card" },
    title,
    sub,
    chips,
    ...lines,
    ...(s.gap === "major" ? majorList(s) : []),
    h("label", { class: "check" }, toggle, "大更新自动执行"),
    h("div", { class: CLS.meta }, "开着时 Agent 遇到大更新自己运行 hxaioa upgrade; 触发语和定时间隔的改动仍只提示。"),
    h("div", { class: "btn-row" }, button(TXT_COPY, copy, s.gap === "major" ? CLS.primary : CLS.ghostSm, "copy")),
    status,
  );
}

/** 群 Agent 区: 打开页面时拉一次群资料, 之后只在服务端广播 chat_sync 时重拉; 待处理按本地事件算。 */
export function groupAgents(env: Env): HTMLElement {
  let metas: ChatMeta[] = [];
  const load = () =>
    api<{ chats: ChatMeta[] }>(PATH_CHATS)
      .then((r) => ((metas = r.chats.filter((m) => !m.deleted && m.agents?.length)), region.update()))
      .catch(() => undefined);
  const region = keyedRegion(
    (el) => {
      const cards = metas.flatMap((m) => (m.agents ?? []).map((a) => agentCard(m, a, env, load)));
      if (cards.length) el.append(section("群 Agent", "bot", ...cards));
    },
    () => `${JSON.stringify(metas)}|${env.store.events.size}|${Math.floor(Date.now() / RENDER_TICK_MS)}`,
  );
  env.scope.add(env.store.on(TOPIC_CHAT_SYNC, load));
  env.scope.add(env.store.on(TOPIC_EVENTS, region.update));
  env.scope.interval(region.update, RENDER_TICK_MS);
  void load();
  return region.el;
}
