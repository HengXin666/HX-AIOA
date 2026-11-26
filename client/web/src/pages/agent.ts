import type { TaskLogEntry, TaskSnapshot } from "@hx-aioa/protocol";
import { CLS, FIELD_TASK, TASKS_PATH, TXT_LOADING } from "../constants";
import { promptBox, replyForm, TASK_STATE_TEXT, taskCard } from "../components/cards";
import { api, hasServer } from "../core/api";
import { groupAgents } from "../components/agent-card";
import { button, h, timeText } from "../core/dom";
import { topicOf, TOPIC_AGENTS, TOPIC_TASKS } from "../core/store";
import { emptyNote, keyedRegion, pageHead, section, type Env } from "./page";

const GROUPS: { title: string; ic: string; states: TaskSnapshot["state"][] }[] = [
  { title: "等待确认", ic: "bell", states: ["waiting"] },
  { title: "进行中", ic: "activity", states: ["running"] },
  { title: "已结束", ic: "circle-check", states: ["done", "failed", "cancelled"] },
];

export function agentPage(root: HTMLElement, env: Env, id?: string): void {
  if (id) return taskDetail(root, env, decodeURIComponent(id));
  const body = keyedRegion(
    (el) => {
      const all = [...env.store.tasks.values()].sort((a, b) => b.updated - a.updated);
      if (!all.length) return void el.append(emptyNote(env.store.ready ? "还没有 Agent 任务" : TXT_LOADING, "bot"));
      for (const g of GROUPS) {
        const list = all.filter((t) => g.states.includes(t.state));
        if (list.length) el.append(section(g.title, g.ic, ...list.map((t) => taskCard(t, env.actions, g.states[0] !== "waiting"))));
      }
    },
    () => [...env.store.tasks.values()].map((t) => `${t.id}:${t.state}:${t.progress}:${t.prompt?.id}`).join(),
  );
  const online = keyedRegion(
    (el) => {
      if (!env.store.agents.length) return;
      el.append(h("div", { class: "row wrap" }, ...env.store.agents.map((a) => h("span", { class: a.online ? "chip on" : "chip" }, `${a.name} ${a.online ? "在线" : "离线"}`))));
    },
    () => env.store.agents.map((a) => `${a.id}:${a.online}`).join(),
  );
  root.append(pageHead("Agent", "任务进度, 待确认与完整对话"), online.el);
  if (hasServer() && env.actions.mode === "live") root.append(groupAgents(env));
  root.append(body.el);
  env.scope.add(env.store.on(TOPIC_TASKS, body.update));
  env.scope.add(env.store.on(TOPIC_AGENTS, online.update));
  online.update();
  body.update();
}

const ROLE_CLASS: Record<TaskLogEntry["role"], string> = { agent: "bubble", user: "bubble mine", system: CLS.sysBubble };

function taskDetail(root: HTMLElement, env: Env, id: string): void {
  const { store, actions } = env;
  const head = h("div", {});
  const log = h("div", { class: "convo" });
  const promptHost = h("div", {});
  let promptSig = "";
  const draw = () => {
    const t = store.tasks.get(id);
    head.replaceChildren(
      pageHead(t?.title ?? id, t ? `${t.agent} · ${TASK_STATE_TEXT[t.state]}${t.step ? ` · ${t.step}` : ""}` : "任务不存在或尚未加载", "#/agent"),
    );
    if (t?.state === "running") head.append(h("div", { class: "bar" }, h("i", { style: `width:${Math.round((t.progress ?? 0) * 100)}%` })));
    const entries = store.logs.get(id) ?? [];
    log.replaceChildren(
      ...entries.map((e) => h("div", { class: ROLE_CLASS[e.role] }, e.text ?? e.kind, h("div", { class: CLS.meta }, timeText(e.ts)))),
    );
    if (t?.result) log.append(h("div", { class: CLS.sysBubble }, `结果: ${t.result}`));
    const sig = `${t?.state}:${t?.prompt?.id}`;
    if (sig !== promptSig) {
      promptSig = sig;
      const box = t ? promptBox(t, actions) : null;
      promptHost.replaceChildren(...(box ? [box] : []));
    }
    log.scrollTop = log.scrollHeight;
  };
  const cancel = button("取消任务", () => actions.act({ taskId: id, kind: "cancel" }, true), "btn ghost sm danger-text", "x");
  root.append(head, log, promptHost, h("div", { class: "composer" }, replyForm(id, actions, "ask"), cancel));
  env.scope.add(store.on(topicOf(id, FIELD_TASK), draw));
  draw();
  if (hasServer() && actions.mode === "live" && !store.logs.has(id)) {
    api<{ task: TaskSnapshot; log: TaskLogEntry[] }>(`${TASKS_PATH}/${encodeURIComponent(id)}`)
      .then((r) => {
        store.setLog(id, r.log);
        store.ingestTask(r.task);
      })
      .catch((e: Error) => log.append(h("div", { class: CLS.sysBubble }, `加载对话失败: ${e.message}`)));
  }
}
