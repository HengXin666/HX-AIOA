// HX-AIOA Service Worker: 只处理 Web Push 通知; 不做离线缓存, 不拦截 fetch, 免得和静态资源缓存冲突
const HOME = "/";
const CHAT_HASH = "/#/c/";
const DEFAULT_TITLE = "HX-AIOA";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

function readPayload(event) {
  if (!event.data) return {};
  try {
    return event.data.json();
  } catch {
    return { body: event.data.text() };
  }
}

const windows = () => self.clients.matchAll({ type: "window", includeUncontrolled: true });

async function onPush(event) {
  const p = readPayload(event);
  // 页面在前台可见: 页面自己会显示, 不再弹系统通知
  if ((await windows()).some((c) => c.visibilityState === "visible")) return;
  // Agent GUI 审批 (#126) 直接带 url ("/#/agent/gui/<主机>/<会话>"); 同 tag 的旧通知被替换, 静默推送不出声
  const url = typeof p.url === "string" && p.url.startsWith(HOME) ? p.url : p.channel ? CHAT_HASH + encodeURIComponent(p.channel) : HOME;
  const silent = p.silent === true;
  await self.registration.showNotification(p.title || DEFAULT_TITLE, {
    body: p.body || "",
    tag: p.tag || DEFAULT_TITLE,
    renotify: Boolean(p.tag) && !silent,
    silent,
    data: { url, seq: p.seq },
  });
}

async function onClick(event) {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || HOME, self.location.origin).href;
  const list = await windows();
  const win = list.find((c) => new URL(c.url).origin === self.location.origin);
  if (!win) return void (await self.clients.openWindow(url));
  await win.focus();
  try {
    await win.navigate(url);
  } catch {
    // 不受本 SW 控制的窗口不能 navigate, 交给页面自己跳
    win.postMessage({ t: "open", url });
  }
}

self.addEventListener("push", (event) => event.waitUntil(onPush(event)));
self.addEventListener("notificationclick", (event) => event.waitUntil(onClick(event)));
