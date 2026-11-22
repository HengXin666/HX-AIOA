import { PATH_EVENTS, type Envelope, type KeyCreated, type SourceInfo, type SourceTypeInfo } from "@hx-aioa/protocol";
import { CLS } from "../constants";
import { api } from "../core/api";
import { button, h, icon } from "../core/dom";
import { createdKey, createSource, deleteSource, eventsUrl, getSource, GITHUB, hookUrl, repoOf, sourceTypes } from "../core/sources";
import { TOPIC_EVENTS } from "../core/store";
import { emptyNote, pageHead, section, type Env } from "./page";

const BASE = "#/me/sources";
const BACK = "#/me";
const NEW = "new";
const JSON_TYPE = "application/json";
const CONNECTED = "已连接 ✓";
const POLL_MS = 5_000;
const MOCK_PING_MS = 3_000;
const CLS_STEP = "src-step";
const CLS_ERR = "danger-text meta";
const RECENT_BACK = 50;
const GITHUB_EVENTS = ["Pushes", "Pull requests", "Issues", "Issue comments", "Workflow runs", "Releases", "Stars"];

export const sourcePath = (id: string) => `${BASE}/${encodeURIComponent(id)}`;

function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  return h("label", { class: "field" }, h("span", { class: "field-label" }, label), control, hint ? h("span", { class: CLS.meta }, hint) : null);
}

async function copy(text: string, btn: HTMLButtonElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = "已复制";
  } catch {
    btn.textContent = "请手动复制";
  }
}

// 只读输入框 + 复制按钮, 长地址也能完整选中
function copyRow(label: string, value: string): HTMLElement {
  const input = h("input", { class: "input mono", readonly: true, value });
  input.addEventListener("focus", () => input.select());
  const btn = h("button", { class: CLS.ghostSm, type: "button" }, icon("copy"), "复制");
  btn.addEventListener("click", () => void copy(value, btn));
  return field(label, h("div", { class: "row copy-row" }, input, btn));
}

function step(n: number, title: string, ...body: (Node | null)[]): HTMLElement {
  return h("div", { class: CLS_STEP }, h("div", { class: "src-step-no" }, String(n)), h("div", { class: "src-step-body" }, h("div", { class: "ev-title" }, title), ...body));
}

const note = (text: string, cls: string = CLS.meta) => h("div", { class: cls }, text);

// 添加: 选类型 → 名称与关注对象 → 创建后跳到详情页
function newPage(root: HTMLElement, env: Env): void {
  const body = h("div", { class: "region" });
  const err = note("", CLS_ERR);
  root.append(pageHead("添加数据源", "选择类型, 创建后按步骤接入", BACK), body);
  let types: SourceTypeInfo[] = [];
  let picked: SourceTypeInfo | undefined;

  const drawForm = () => {
    const t = picked!;
    const gh = t.type === GITHUB;
    const name = h("input", { class: "input", name: "name", placeholder: t.name });
    const subject = h("input", { class: "input", name: "subject", placeholder: gh ? "owner/repo" : "可选, 例如 nas" });
    const form = h(
      "form",
      { class: "card pad rule-form" },
      h("div", { class: "row" }, h("span", { class: "ev-ic" }, icon(t.icon)), h("div", { class: "ev-title" }, t.name)),
      t.setup ? note(t.setup) : null,
      field(gh ? "仓库 (owner/repo)" : "关注对象 (可选)", subject, gh ? "用来生成 GitHub 设置页链接, 事件会归到 github:owner/repo" : "事件默认归到这个对象下"),
      field("名称", name, "留空则用类型名或仓库名"),
      err,
      h("div", { class: "btn-row" }, h("button", { class: CLS.primary, type: "submit" }, "创建"), button("换个类型", () => ((picked = undefined), draw()), "btn ghost")),
    );
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const raw = subject.value.trim();
      const repo = repoOf(raw);
      if (gh && !repo) return void (err.textContent = "请填写 owner/repo, 例如 HengXin666/HX-AIOA");
      const input = { name: name.value.trim() || (gh ? repo : t.name), type: t.type, ...(gh ? { subject: `${GITHUB}:${repo}` } : raw ? { subject: raw } : {}) };
      err.textContent = "创建中...";
      createSource(env.actions.mode, input, t)
        .then((s) => (location.hash = sourcePath(s.id)))
        .catch((x: Error) => (err.textContent = x.message));
    });
    body.replaceChildren(form);
    subject.focus();
  };

  const draw = () => {
    if (picked) return drawForm();
    const list = h("div", { class: CLS.cardList });
    for (const t of types) {
      list.append(
        h(
          "button",
          { class: "ev menu src-type", type: "button", onclick: () => ((picked = t), draw()) },
          h("span", { class: "ev-ic" }, icon(t.icon)),
          h("div", { class: "ev-main" }, h("div", { class: "ev-title" }, t.name, t.type === GITHUB ? h("span", { class: "chip on" }, "推荐") : null), h("div", { class: CLS.meta }, t.setup ?? "")),
          icon("chevron-right"),
        ),
      );
    }
    body.replaceChildren(section("选择类型", "plug", list));
  };

  if (env.actions.mode === "none") return void body.append(emptyNote("未配置服务端, 可加 ?mock=1 预览这个流程", "wifi-off"));
  sourceTypes(env.actions.mode)
    .then((t) => ((types = t), draw()))
    .catch((x: Error) => body.replaceChildren(note(x.message, CLS_ERR)));
}

function secretNote(k: KeyCreated): HTMLElement {
  return note(k.webhookSecret ? "Key 与 Secret 只显示这一次, 离开本页后无法再查看, 请现在填好。" : "服务端没有配置 TOKEN_SECRET, 无法生成 Secret 验签。下面改用带 ?key= 的地址, Secret 留空。", k.webhookSecret ? "warn-text meta" : CLS_ERR);
}

function githubSteps(s: SourceInfo, t: SourceTypeInfo | undefined, k: KeyCreated | undefined): HTMLElement {
  const repo = repoOf(s.subject);
  const url = repo ? `https://github.com/${repo}/settings/hooks/new` : "";
  const open = url
    ? h("a", { class: CLS.primary, href: url, target: "_blank", rel: "noopener" }, icon("external-link"), `打开 ${repo} 的 Webhook 设置`)
    : note("没有填写仓库, 请在 GitHub 仓库页 Settings -> Webhooks -> Add webhook 打开。");
  const signed = Boolean(k?.webhookSecret);
  const payload = k ? copyRow("Payload URL", hookUrl(k, t, !signed)) : note("Payload URL 只在创建时显示。");
  const secret = k && signed ? copyRow("Secret", k.webhookSecret) : note(k ? "Secret 留空 (地址里已带 key)。" : "Secret 只在创建时显示。");
  return h(
    "div",
    { class: "card pad region" },
    k ? secretNote(k) : null,
    step(1, "打开仓库的 Webhook 设置页", open, note("需要仓库管理员权限。组织级 Webhook 在组织 Settings -> Webhooks。")),
    step(2, "填写 Payload URL", payload),
    step(3, "Content type 选 application/json", note(`默认是 x-www-form-urlencoded, 也能用, 但推荐 ${JSON_TYPE}。`)),
    step(4, "填写 Secret", secret),
    step(5, "选择事件", note("选 Let me select individual events, 建议勾选:"), h("div", { class: "checks" }, ...GITHUB_EVENTS.map((e) => h("span", { class: "chip" }, e))), note("只想看 CI 结果就只勾 Workflow runs。")),
    step(6, "点 Add webhook", note("GitHub 会立刻发一个 ping, 本页顶部会变成 已连接 ✓。之后普通动态进摘要, CI 失败和请求我审查会提醒。")),
  );
}

function genericSteps(s: SourceInfo, t: SourceTypeInfo | undefined, k: KeyCreated | undefined): HTMLElement {
  const box = h("div", { class: "card pad region" });
  if (!k) {
    box.append(note("接入地址和 Key 只在创建时显示一次, 已无法再查看。需要重新配置时删除后重建。"));
    return box;
  }
  box.append(secretNote(k));
  if (t?.adapter) box.append(step(1, "在对方系统里填写 Webhook 地址", copyRow("Webhook 地址 (已带 ?key=)", hookUrl(k, t, true)), note("地址里的 key 就是凭证, 不要公开。")));
  else box.append(step(1, "用 Key 调用事件接口", copyRow("事件接口", eventsUrl()), note(`请求头 Authorization: Bearer <Key>, Content-Type: ${JSON_TYPE}`)));
  box.append(copyRow("Key", k.key));
  if (t?.setup) box.append(step(2, "配置说明", note(t.setup)));
  box.append(note(`事件会归到来源 "${s.name}"${s.subject ? `, 关注对象 ${s.subject}` : ""}。收到第一条事件后本页显示 ${CONNECTED}。`));
  return box;
}

const fromSource = (id: string) => (e: Envelope) => e.source.id === id;

// 等待第一条事件: 实时流推来的直接命中; 流断开时轮询一次历史兜底
function watchConnected(env: Env, s: SourceInfo, badge: HTMLElement): void {
  let done = false;
  const hit = (e: Envelope | undefined) => {
    if (done || !e) return;
    done = true;
    badge.className = "chip st-done";
    badge.textContent = CONNECTED;
    badge.title = e.kind === "event" || e.kind === "report" ? e.data.title : "";
  };
  const scan = () => hit([...env.store.events.values()].find(fromSource(s.id)));
  env.scope.add(env.store.on(TOPIC_EVENTS, scan));
  scan();
  if (env.actions.mode === "live") {
    let since = -1;
    const poll = () => {
      if (done) return;
      if (since < 0) {
        api<{ head: number }>(`${PATH_EVENTS}?limit=1`).then((r) => ((since = Math.max(0, r.head - RECENT_BACK)), poll())).catch(() => undefined);
        return;
      }
      api<{ events: Envelope[]; head: number }>(`${PATH_EVENTS}?since=${since}&limit=200`)
        .then((r) => ((since = r.head), hit(r.events.find(fromSource(s.id)))))
        .catch(() => undefined);
    };
    poll();
    env.scope.interval(poll, POLL_MS);
  }
  if (env.actions.mode === "mock") {
    const repo = repoOf(s.subject).split("/").pop() || s.name;
    const title = s.type === GITHUB ? `[${repo}] GitHub Webhook 已连接` : `${s.name} 第一条事件`;
    const id = window.setTimeout(() => env.store.ingest({ id: `e_mock_${s.id}`, seq: 0, ts: Date.now(), kind: "event", priority: "happening", source: { id: s.id, name: s.name, type: s.type }, ...(s.subject ? { subject: s.subject } : {}), data: { title, severity: "info" } } as Envelope), MOCK_PING_MS);
    env.scope.add(() => window.clearTimeout(id));
  }
}

function detailPage(root: HTMLElement, env: Env, id: string): void {
  const body = h("div", { class: "region" });
  root.append(body);
  Promise.all([getSource(env.actions.mode, id), sourceTypes(env.actions.mode).catch(() => [])])
    .then(([s, types]) => {
      if (!s) return void body.replaceChildren(pageHead("数据源", undefined, BACK), emptyNote("找不到这个数据源", "triangle-alert"));
      const t = types.find((x) => x.type === s.type);
      const k = createdKey(s.id);
      const badge = h("span", { class: "chip st-waiting" }, "等待第一条事件...");
      const del = button("删除数据源", () => {
        if (!window.confirm(`删除 "${s.name}"? 绑定的接入 key 会一起作废。`)) return;
        deleteSource(env.actions.mode, s.id).then(() => (location.hash = BACK)).catch((x: Error) => (del.textContent = x.message));
      }, "btn danger", "trash");
      body.replaceChildren(
        pageHead(s.name, `${t?.name ?? s.type}${s.subject ? ` · ${s.subject}` : ""}`, BACK),
        h("div", { class: "row" }, icon(t?.icon ?? s.icon ?? "plug"), h("span", { class: CLS.meta }, "状态"), badge),
        section("接入步骤", "key", s.type === GITHUB ? githubSteps(s, t, k) : genericSteps(s, t, k)),
        h("div", { class: "btn-row" }, del),
      );
      watchConnected(env, s, badge);
    })
    .catch((x: Error) => body.replaceChildren(pageHead("数据源", undefined, BACK), note(x.message, CLS_ERR)));
}

// #/me/sources/new 添加; #/me/sources/{id} 详情
export function sourcesPage(root: HTMLElement, env: Env, arg?: string): void {
  if (!arg || arg === NEW) return newPage(root, env);
  detailPage(root, env, decodeURIComponent(arg));
}
