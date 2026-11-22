import type { Envelope, Panel, Priority, Space } from "@hx-aioa/protocol";
import { HAPPENING_LIMIT, STORAGE_DONE, STORAGE_SAVED, WORTH_BATCH, CLS, LAYER_TEXT } from "../constants";
import { eventRow, taskCard } from "../components/cards";
import { renderPanel } from "../components/space";
import { button, h, icon } from "../core/dom";
import { IdSet } from "../core/prefs";
import { Scope } from "../core/scope";
import { TOPIC_EVENTS, TOPIC_LINK, TOPIC_SPACES, TOPIC_TASKS } from "../core/store";
import { emptyNote, keyedRegion, section, type Env } from "./page";

const saved = new IdSet(STORAGE_SAVED);
const done = new IdSet(STORAGE_DONE);
const TREND_SPACE: Space = { id: "overview", title: "总览", panels: [] };

function layer(env: Env, p: Priority): Envelope[] {
  return [...env.store.events.values()].filter((e) => e.priority === p && !done.has(e.id)).sort((a, b) => b.ts - a.ts);
}

// 同 groupKey 折叠成一组, 保留组内条数, 原始事件可在动态页追溯
function grouped(list: Envelope[]): { ev: Envelope; count: number }[] {
  const out = new Map<string, { ev: Envelope; count: number }>();
  for (const ev of list) {
    const k = ev.groupKey ?? ev.id;
    const g = out.get(k);
    if (g) g.count++;
    else out.set(k, { ev, count: 1 });
  }
  return [...out.values()];
}

function greeting(): string {
  const hr = new Date().getHours();
  return hr < 6 ? "夜深了" : hr < 12 ? "早上好" : hr < 18 ? "下午好" : "晚上好";
}

function trendPanel(env: Env): Panel | null {
  const subjects = env.store.subjects().filter((s) => env.store.seriesOf({ subject: s, field: "cpu" }).length > 1);
  if (!subjects.length) return null;
  return {
    id: "trend",
    title: "资源趋势",
    icon: "activity",
    refresh: { mode: "push" },
    items: subjects.slice(0, 4).map((subject) => ({ id: `t-${subject}`, type: "sparkline", title: `${subject} CPU`, bind: [{ subject, field: "cpu", range: "5m" }] })),
  };
}

export function overviewPage(root: HTMLElement, env: Env): void {
  const { store, actions } = env;
  const status = h("span", { class: CLS.meta });
  root.append(h("header", { class: "page-head" }, h("div", {}, h("h1", {}, greeting()), status)));

  const needMe = keyedRegion(
    (el) => {
      const tasks = [...store.tasks.values()].filter((t) => t.state === "waiting");
      const evs = layer(env, "need_me");
      tasks.forEach((t) => el.append(taskCard(t, actions)));
      if (evs.length) el.append(h("div", { class: CLS.cardList }, ...evs.map((ev) => eventRow(ev, { onDone: () => (done.toggle(ev.id, true), refresh()) }))));
      if (!tasks.length && !evs.length) el.append(emptyNote("没有需要你处理的事"));
    },
    () => [...store.tasks.values()].filter((t) => t.state === "waiting").map((t) => `${t.id}:${t.prompt?.id}`).join() + "|" + layer(env, "need_me").map((e) => e.id).join(),
  );

  const happening = keyedRegion(
    (el) => {
      const running = [...store.tasks.values()].filter((t) => t.state === "running");
      running.forEach((t) => el.append(taskCard(t, actions, true)));
      const groups = grouped(layer(env, "happening"));
      const list = h("div", { class: CLS.cardList });
      groups.slice(0, HAPPENING_LIMIT).forEach(({ ev, count }) => {
        const row = eventRow(ev);
        if (count > 1) row.querySelector(".ev-title")?.append(h("span", { class: "chip" }, `+${count - 1}`));
        list.append(row);
      });
      if (groups.length) el.append(list);
      if (groups.length > HAPPENING_LIMIT) el.append(h("a", { class: "more", href: "#/feed" }, `还有 ${groups.length - HAPPENING_LIMIT} 组, 查看全部动态`, icon("chevron-right")));
      if (!running.length && !groups.length) el.append(emptyNote("一切平静", "activity"));
    },
    () => [...store.tasks.values()].filter((t) => t.state === "running").map((t) => `${t.id}:${t.progress}`).join() + "|" + layer(env, "happening").map((e) => e.id).join(),
  );

  const trendHost = h("div", {});
  let trendScope = new Scope();
  env.scope.add(() => trendScope.dispose());
  let trendSig = "";
  const drawTrend = () => {
    const panel = trendPanel(env);
    const sig = panel?.items.map((i) => i.id).join() ?? "";
    if (sig === trendSig) return;
    trendSig = sig;
    trendScope.dispose();
    trendScope = new Scope();
    trendHost.replaceChildren();
    if (panel) trendHost.append(renderPanel({ ...env, scope: trendScope }, TREND_SPACE, panel));
  };

  let offset = 0;
  let sigBump = 0;
  const worth = keyedRegion(
    (el) => {
      const all = layer(env, "worth_reading");
      const batch = all.slice(offset, offset + WORTH_BATCH);
      const redraw = () => worth.update();
      const card = h("div", { class: CLS.cardList });
      batch.forEach((ev) =>
        card.append(
          eventRow(ev, {
            saved: saved.has(ev.id),
            onSave: () => (saved.toggle(ev.id), (sigBump++, redraw())),
            onSkip: () => (offset++, redraw()),
            onDone: () => (done.toggle(ev.id, true), redraw()),
          }),
        ),
      );
      if (batch.length) el.append(card);
      const rest = all.length - offset - batch.length;
      if (!batch.length) {
        el.append(emptyNote(all.length ? "这一批看完了" : "今天没有更多内容, 去忙自己的事吧", "sparkles"));
        if (all.length) el.append(button("从头再看", () => ((offset = 0), redraw()), CLS.ghostSm, "rotate-ccw"));
      } else if (rest > 0) {
        el.append(button(`换一批 (还有 ${rest} 条)`, () => ((offset += WORTH_BATCH), redraw()), CLS.ghostSm, "refresh-cw"));
      }
    },
    () => `${offset}|${sigBump}|` + layer(env, "worth_reading").map((e) => e.id).join(),
  );

  root.append(
    section(LAYER_TEXT.need_me, "bell", needMe.el),
    section(LAYER_TEXT.happening, "activity", happening.el, trendHost),
    section(LAYER_TEXT.worth_reading, "sparkles", worth.el),
  );
  const refresh = () => {
    status.textContent = store.linkError ?? (store.online ? `${actions.mode === "mock" ? "模拟数据" : "已连接"} · 一切数据实时` : "未连接");
    needMe.update();
    happening.update();
    worth.update();
    drawTrend();
  };
  for (const t of [TOPIC_EVENTS, TOPIC_TASKS, TOPIC_LINK, TOPIC_SPACES]) env.scope.add(store.on(t, refresh));
  refresh();
}
