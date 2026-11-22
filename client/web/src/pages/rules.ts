import {
  DELIVERY_CHANNELS,
  KINDS,
  parseRule,
  PRIORITIES,
  RULE_ACTIONS,
  SEVERITIES,
  type Rule,
  type RuleInput,
} from "@hx-aioa/protocol";
import { RULES_PATH, TXT_OFFLINE_SAVE, TXT_SAVED, CLS, LAYER_TEXT } from "../constants";
import { api, hasServer, json } from "../core/api";
import { button, h, icon } from "../core/dom";
import { emptyNote, pageHead, type Env } from "./page";

const ACTION_TEXT: Record<Rule["action"], string> = {
  alert: "响铃提醒",
  push: "普通通知",
  silent: "静默",
  digest: "进摘要",
  aggregate: "合并",
  drop: "丢弃",
};
const LABELS: Record<string, string> = {
  metric: "指标", event: "事件", task: "任务", report: "报告",
  critical: "严重", warning: "警告", normal: "普通", info: "信息",
  need_me: LAYER_TEXT.need_me, happening: LAYER_TEXT.happening, worth_reading: LAYER_TEXT.worth_reading,
  ws: "应用内", mipush: "小米推送", wxpusher: "微信", next_open: "下次打开",
};

const SAMPLE: Rule[] = [
  { id: "r_nas", name: "NAS 信息级只进摘要", enabled: true, when: { sources: ["src_server"], severities: ["info"] }, action: "digest" },
  { id: "r_night", name: "夜间只响严重告警", enabled: true, when: { severities: ["warning", "normal"] }, window: { start: "23:00", end: "08:00", days: "all" }, action: "silent" },
  { id: "builtin:need-me", name: "需要我: 响铃", enabled: true, when: { priorities: ["need_me"] }, action: "alert", channels: ["ws", "mipush"], builtin: true },
];

const itemPath = (id: string) => `${RULES_PATH}/${encodeURIComponent(id)}`;
const csv = (v: string) => v.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);

function checks(name: string, list: readonly string[], picked: readonly string[] = []): HTMLElement {
  return h(
    "div",
    { class: "checks" },
    ...list.map((v) => h("label", { class: "check" }, h("input", { type: "checkbox", name, value: v, checked: picked.includes(v) }), LABELS[v] ?? v)),
  );
}

function field(label: string, control: HTMLElement): HTMLElement {
  return h("label", { class: "field" }, h("span", { class: "field-label" }, label), control);
}

function summary(r: Rule): string {
  const w = r.when;
  const parts = [
    w.kinds?.map((k) => LABELS[k]).join("/"),
    w.severities?.map((k) => LABELS[k]).join("/"),
    w.priorities?.map((k) => LABELS[k]).join("/"),
    w.subjects?.join("/"),
    w.keywords?.length ? `含 "${w.keywords.join(" ")}"` : "",
    r.window ? `${r.window.start ?? "00:00"}-${r.window.end ?? "24:00"}` : "",
  ].filter(Boolean);
  return `${parts.join(" · ") || "全部事件"} → ${ACTION_TEXT[r.action]}`;
}

function editor(rule: Partial<Rule>, onSave: (r: RuleInput) => void, onCancel: () => void): HTMLElement {
  const w = rule.when ?? {};
  const form = h(
    "form",
    { class: "card rule-form" },
    field("名称", h("input", { class: "input", name: "name", value: rule.name ?? "", required: true })),
    h("label", { class: "check" }, h("input", { type: "checkbox", name: "enabled", checked: rule.enabled !== false }), "启用"),
    field("动作", h("select", { class: "input", name: "action" }, ...RULE_ACTIONS.map((a) => h("option", { value: a, selected: rule.action === a }, ACTION_TEXT[a])))),
    field("类型", checks("kinds", KINDS, w.kinds)),
    field("级别", checks("severities", SEVERITIES, w.severities)),
    field("分层", checks("priorities", PRIORITIES, w.priorities)),
    field("来源 id (逗号分隔, 支持 *)", h("input", { class: "input", name: "sources", value: w.sources?.join(", ") ?? "" })),
    field("关注对象", h("input", { class: "input", name: "subjects", value: w.subjects?.join(", ") ?? "" })),
    field("关键词", h("input", { class: "input", name: "keywords", value: w.keywords?.join(", ") ?? "" })),
    h(
      "div",
      { class: "row" },
      field("开始", h("input", { class: "input", type: "time", name: "start", value: rule.window?.start ?? "" })),
      field("结束", h("input", { class: "input", type: "time", name: "end", value: rule.window?.end ?? "" })),
      field("日期", h("select", { class: "input", name: "days" }, ...[["all", "每天"], ["weekday", "工作日"], ["weekend", "周末"]].map(([v, t]) => h("option", { value: v!, selected: rule.window?.days === v }, t!)))),
    ),
    field("推送渠道", checks("channels", DELIVERY_CHANNELS, rule.channels)),
    h("label", { class: "check" }, h("input", { type: "checkbox", name: "bypassQuiet", checked: rule.bypassQuiet === true }), "免打扰时段也提醒"),
  );
  const err = h("div", { class: "danger-text meta" });
  form.append(err, h("div", { class: "btn-row" }, h("button", { class: CLS.primary, type: "submit" }, "保存"), button("取消", onCancel, "btn ghost")));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const str = (k: string) => String(fd.get(k) ?? "");
    const list = (k: string) => fd.getAll(k).map(String);
    const when: Record<string, string[]> = {};
    for (const k of ["kinds", "severities", "priorities"]) if (list(k).length) when[k] = list(k);
    for (const k of ["sources", "subjects", "keywords"]) if (csv(str(k)).length) when[k] = csv(str(k));
    const raw: Record<string, unknown> = { id: rule.id, name: str("name"), enabled: fd.has("enabled"), action: str("action"), when, bypassQuiet: fd.has("bypassQuiet") };
    if (str("start") || str("end")) raw.window = { start: str("start") || undefined, end: str("end") || undefined, days: str("days") };
    if (list("channels").length) raw.channels = list("channels");
    const parsed = parseRule(raw);
    if (typeof parsed === "string") err.textContent = parsed;
    else onSave(parsed);
  });
  return form;
}

// 规则列表与编辑: 自上而下匹配, 内置规则在最后且只读
export function rulesPage(root: HTMLElement, env: Env): void {
  let rules: Rule[] = [];
  let editing: Partial<Rule> | null = null;
  const note = h("div", { class: CLS.meta });
  const body = h("div", {});
  const live = hasServer() && env.actions.mode === "live";

  const draw = () => {
    body.replaceChildren();
    if (editing) return void body.append(editor(editing, save, () => ((editing = null), draw())));
    body.append(button("新建规则", () => ((editing = { enabled: true, action: "push", when: {} }), draw()), CLS.primary, "plus"));
    if (!rules.length) return void body.append(emptyNote("没有规则, 事件按默认分层处理", "settings"));
    const list = h("div", { class: CLS.cardList });
    rules.forEach((r, i) => {
      const ops = r.builtin
        ? h("span", { class: "chip" }, "内置")
        : h(
            "span",
            { class: "row tools" },
            h("button", { class: CLS.ghostSm, type: "button", "aria-label": "上移", onclick: () => move(i, -1) }, icon("chevron-up")),
            button("编辑", () => ((editing = r), draw()), CLS.ghostSm),
            h("button", { class: CLS.ghostSm, type: "button", "aria-label": "删除", onclick: () => remove(r) }, icon("trash")),
          );
      list.append(
        h(
          "div",
          { class: `ev rule${r.enabled ? "" : " off"}` },
          h("div", { class: "ev-main" }, h("div", { class: "ev-title" }, `${i + 1}. ${r.name}`), h("div", { class: CLS.meta }, summary(r))),
          ops,
        ),
      );
    });
    body.append(list);
  };

  const fail = (e: Error) => (note.textContent = e.message);
  const load = () => {
    if (!live) {
      rules = rules.length ? rules : structuredClone(SAMPLE);
      note.textContent = TXT_OFFLINE_SAVE;
      return draw();
    }
    api<{ rules: Rule[] }>(RULES_PATH).then((r) => ((rules = r.rules), draw())).catch(fail);
  };

  function save(input: RuleInput): void {
    const local = () => {
      const r: Rule = { ...input, id: input.id ?? `r_${Date.now()}` };
      const i = rules.findIndex((x) => x.id === r.id);
      if (i >= 0) rules[i] = r;
      else rules.splice(rules.findIndex((x) => x.builtin) >>> 0, 0, r);
      editing = null;
      note.textContent = live ? TXT_SAVED : TXT_OFFLINE_SAVE;
      draw();
    };
    if (!live) return local();
    const req = input.id ? api(itemPath(input.id), json("PUT", input)) : api(RULES_PATH, json("POST", input));
    req.then(() => ((editing = null), (note.textContent = TXT_SAVED), load())).catch(fail);
  }

  function remove(r: Rule): void {
    if (!window.confirm(`删除规则 "${r.name}"?`)) return;
    rules = rules.filter((x) => x.id !== r.id);
    draw();
    if (live) api(itemPath(r.id), { method: "DELETE" }).catch(fail);
  }

  function move(i: number, d: number): void {
    const j = i + d;
    if (j < 0 || rules[j]?.builtin) return;
    [rules[i], rules[j]] = [rules[j]!, rules[i]!];
    draw();
    if (live) api(`${RULES_PATH}/order`, json("PUT", { ids: rules.filter((r) => !r.builtin).map((r) => r.id) })).catch(fail);
  }

  root.append(pageHead("规则", "决定事件如何提醒, 从上到下第一条命中生效", "#/me"), note, body);
  load();
}
