import "./tokens.css";
import "./style.css";
import "./components.css";
import "./cards.css";
import "./charts.css";
import { AUTH_TOKEN, QUERY_MOCK, SERVER_URL } from "./constants";
import { Actions } from "./core/backend";
import { h, icon } from "./core/dom";
import { MockBackend } from "./core/mock";
import { Scope } from "./core/scope";
import { Store } from "./core/store";
import { offlineBackend, StreamLink } from "./core/stream";
import { loadDevice, startLegacyLink } from "./legacy";
import { agentPage } from "./pages/agent";
import { feedPage } from "./pages/feed";
import { lookPage } from "./pages/look";
import { mePage } from "./pages/me";
import { overviewPage } from "./pages/overview";
import type { Env, Page } from "./pages/page";
import { readerPage, resourcesPage } from "./pages/resources";
import { rulesPage } from "./pages/rules";
import { sourcesPage } from "./pages/sources";
import { AppearanceStore } from "./theme/appearance";

const NAV = [
  { path: "overview", label: "总览", icon: "layout-dashboard" },
  { path: "feed", label: "动态", icon: "rss" },
  { path: "agent", label: "Agent", icon: "bot" },
  { path: "res", label: "资源", icon: "server" },
  { path: "me", label: "我的", icon: "user" },
] as const;

const ROUTES: Record<string, Page> = {
  overview: overviewPage,
  feed: feedPage,
  agent: agentPage,
  res: resourcesPage,
  me: mePage,
  "me/rules": rulesPage,
  "me/look": lookPage,
  "me/sources": sourcesPage,
  read: readerPage,
};

const app = document.querySelector<HTMLElement>("#app")!;
const nav = document.querySelector<HTMLElement>("#nav")!;
const store = new Store();
const look = new AppearanceStore();
look.receive(look.value);

const mock = new URLSearchParams(location.search).has(QUERY_MOCK);
const actions = new Actions(store, offlineBackend);
if (mock) {
  const m = new MockBackend(store);
  actions.setBackend(m);
  m.start();
} else if (SERVER_URL) {
  const s = new StreamLink({ server: SERVER_URL, token: AUTH_TOKEN, device: loadDevice(), onSettings: (v) => look.receive(v.appearance) }, store);
  actions.setBackend(s);
  s.start();
  startLegacyLink();
} else {
  store.setLink(false, "未配置服务端地址, 可加 ?mock=1 预览");
  store.setReady(true);
}

let scope = new Scope();

function route(): void {
  const hash = location.hash.replace(/^#\/?/, "") || "overview";
  // 最长前缀匹配, 剩余部分作为参数: #/me/sources/new -> me/sources + new
  let key = hash;
  while (key && !ROUTES[key]) key = key.includes("/") ? key.slice(0, key.lastIndexOf("/")) : "";
  const page = ROUTES[key] ?? overviewPage;
  const arg = hash.slice(key.length + 1) || undefined;
  scope.dispose();
  scope = new Scope();
  const env: Env = { store, actions, scope, look };
  app.replaceChildren();
  page(app, env, arg);
  const top = key.split("/")[0] === "read" ? "overview" : key.split("/")[0];
  for (const a of nav.querySelectorAll("a")) a.classList.toggle("on", a.dataset.path === top);
  window.scrollTo(0, 0);
}

nav.append(...NAV.map((n) => h("a", { href: `#/${n.path}`, "data-path": n.path }, icon(n.icon), h("span", {}, n.label))));
window.addEventListener("hashchange", route);
route();
