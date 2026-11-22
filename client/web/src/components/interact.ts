import { PATH_TASKS, type Bind, type TaskLogEntry, type TaskSnapshot } from "@hx-aioa/protocol";
import { ANY, CLS, FIELD_TASK } from "../constants";
import { api, hasServer } from "../core/api";
import { h, icon } from "../core/dom";
import { promptBox, TASK_STATE_TEXT } from "./cards";
import { mountWidget, type Ctx } from "./frame";

const CHAT_LINES = 4;
const ROLE_CLASS: Record<TaskLogEntry["role"], string> = { agent: "bubble", user: "bubble mine", system: CLS.sysBubble };

// 交互类组件按 subject 选任务: chat 绑任务 id, approval 绑 Agent id, * 表示全部
const bindsOf = (ctx: Ctx): Bind[] => (ctx.item.bind?.length ? ctx.item.bind : [{ subject: ANY, field: FIELD_TASK }]);
const agentProp = (ctx: Ctx) => (typeof ctx.item.props?.agent === "string" ? ctx.item.props.agent : undefined);
const limitOf = (ctx: Ctx, d: number) => Number(ctx.item.props?.limit ?? d);
const newest = (a: TaskSnapshot, b: TaskSnapshot) => b.updated - a.updated;

export function renderChat(ctx: Ctx): HTMLElement {
  const binds = bindsOf(ctx);
  const ids = binds.map((b) => b.subject);
  const agent = agentProp(ctx);
  const pick = () =>
    [...ctx.store.tasks.values()].filter((t) => (ids.includes(ANY) || ids.includes(t.id)) && (!agent || t.agent === agent)).sort(newest)[0];
  const asked = new Set<string>();
  const root = mountWidget(ctx, {
    binds,
    hasData: () => pick() !== undefined,
    render: (body) => {
      const t = pick()!;
      if (hasServer() && !ctx.store.logs.has(t.id) && !asked.has(t.id)) {
        asked.add(t.id);
        api<{ log: TaskLogEntry[] }>(`${PATH_TASKS}/${encodeURIComponent(t.id)}`).then((r) => ctx.store.setLog(t.id, r.log)).catch(() => undefined);
      }
      const log = (ctx.store.logs.get(t.id) ?? []).slice(-limitOf(ctx, CHAT_LINES));
      body.append(
        h("div", { class: "row between" }, h("strong", {}, t.title), h("span", { class: `chip st-${t.state}` }, TASK_STATE_TEXT[t.state])),
        h("div", { class: "chat-log" }, ...log.map((e) => h("div", { class: ROLE_CLASS[e.role] }, e.text ?? e.kind))),
      );
    },
  });
  // 输入框放在外壳之外, 数据刷新时不会清掉正在输入的文字
  const input = h("input", { class: "input", placeholder: "问 Agent..." });
  const form = h("form", { class: "reply" }, input, h("button", { class: "btn icon-btn", type: "submit", "aria-label": "发送" }, icon("send")));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const t = pick();
    const text = input.value.trim();
    if (t && text && ctx.actions.act({ taskId: t.id, kind: "ask", text })) input.value = "";
  });
  root.append(form);
  return root;
}

export function renderApproval(ctx: Ctx): HTMLElement {
  const binds = bindsOf(ctx);
  const agents = binds.map((b) => b.subject);
  const pick = () =>
    [...ctx.store.tasks.values()]
      .filter((t) => t.state === "waiting" && t.prompt && !t.prompt.expired && (agents.includes(ANY) || agents.includes(t.agent)))
      .sort(newest)
      .slice(0, limitOf(ctx, 3));
  return mountWidget(ctx, {
    binds,
    hasData: () => pick().length > 0,
    render: (body) =>
      pick().forEach((t) =>
        body.append(h("div", { class: "approval" }, h("div", { class: CLS.meta }, `${t.agent} · ${t.title}`), promptBox(t, ctx.actions))),
      ),
  });
}
