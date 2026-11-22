import type { MsgFrame } from "@hx-aioa/protocol";
import { AUTH_TOKEN, DEVICE_PREFIX, SERVER_URL, STATUS_NO_CONFIG, STATUS_OFFLINE, STATUS_ONLINE, STORAGE_DEVICE, STORAGE_SINCE, CLS } from "./constants";
import { h } from "./core/dom";
import { Link } from "./link";

export function loadDevice(): string {
  let id = localStorage.getItem(STORAGE_DEVICE);
  if (!id) {
    id = `${DEVICE_PREFIX}-${crypto.randomUUID().slice(0, 8)}`;
    localStorage.setItem(STORAGE_DEVICE, id);
  }
  return id;
}

const device = loadDevice();
const frames: MsgFrame[] = [];
const seen = new Set<number>();
let since = Number(localStorage.getItem(STORAGE_SINCE) ?? 0);
let link: Link | null = null;
let online = false;
let view: { list: HTMLElement; status: HTMLElement } | null = null;

function row(frame: MsgFrame): HTMLElement {
  const delay = Date.now() - frame.ts;
  return h("div", { class: frame.src === device ? "msg mine" : "msg" }, frame.body.text, h("div", { class: CLS.meta }, `#${frame.seq} · ${frame.src} · 延迟 ${delay}ms`));
}

function onMessage(frame: MsgFrame): void {
  if (seen.has(frame.seq)) return;
  seen.add(frame.seq);
  since = Math.max(since, frame.seq);
  localStorage.setItem(STORAGE_SINCE, String(since));
  frames.push(frame);
  if (view) {
    view.list.append(row(frame));
    view.list.scrollTop = view.list.scrollHeight;
  }
}

const statusText = () => (!SERVER_URL ? STATUS_NO_CONFIG : online ? STATUS_ONLINE : STATUS_OFFLINE);

// 旧的 /ws 文本消息链路, 应用启动即连接, 页面只负责展示
export function startLegacyLink(): void {
  if (!SERVER_URL || link) return;
  link = new Link(
    { server: SERVER_URL, token: AUTH_TOKEN, device, since: () => since },
    {
      onMessage,
      onStatus: (o) => {
        online = o;
        if (view) view.status.textContent = statusText();
      },
    },
  );
  link.start();
}

export function messagesView(): HTMLElement {
  const list = h("div", { class: "msgs" }, ...frames.map(row));
  const status = h("span", { class: CLS.meta }, statusText());
  view = { list, status };
  const input = h("input", { class: "input", autocomplete: "off", placeholder: "说点什么..." });
  const form = h("form", { class: "reply" }, input, h("button", { class: CLS.primary, type: "submit" }, "发送"));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (text && link?.send(crypto.randomUUID(), { kind: "text", text })) input.value = "";
  });
  return h("div", { class: "card messages" }, h("div", { class: "row between" }, h("strong", {}, "消息"), status), list, form);
}
