import type { MsgFrame } from "@hx-aioa/protocol";
import {
  AUTH_TOKEN,
  DEVICE_PREFIX,
  SERVER_URL,
  STATUS_NO_CONFIG,
  STATUS_OFFLINE,
  STATUS_ONLINE,
  STORAGE_DEVICE,
  STORAGE_SINCE,
} from "./constants";
import { Link } from "./link";

const list = document.querySelector<HTMLElement>("#list")!;
const status = document.querySelector<HTMLElement>("#status")!;
const form = document.querySelector<HTMLFormElement>("#composer")!;
const input = document.querySelector<HTMLInputElement>("#input")!;

const device = loadDevice();
const seen = new Set<number>();
let since = Number(localStorage.getItem(STORAGE_SINCE) ?? 0);

function loadDevice(): string {
  let id = localStorage.getItem(STORAGE_DEVICE);
  if (!id) {
    id = `${DEVICE_PREFIX}-${crypto.randomUUID().slice(0, 8)}`;
    localStorage.setItem(STORAGE_DEVICE, id);
  }
  return id;
}

function render(frame: MsgFrame): void {
  if (seen.has(frame.seq)) return;
  seen.add(frame.seq);
  since = Math.max(since, frame.seq);
  localStorage.setItem(STORAGE_SINCE, String(since));

  const el = document.createElement("div");
  el.className = frame.src === device ? "msg mine" : "msg";
  el.textContent = frame.body.text;
  const meta = document.createElement("div");
  meta.className = "meta";
  const delay = Date.now() - frame.ts;
  meta.textContent = `#${frame.seq} · ${frame.src} · 延迟 ${delay}ms`;
  el.appendChild(meta);
  list.appendChild(el);
  list.scrollTop = list.scrollHeight;
}

if (!SERVER_URL) {
  status.textContent = STATUS_NO_CONFIG;
} else {
  const link = new Link(
    { server: SERVER_URL, token: AUTH_TOKEN, device, since: () => since },
    {
      onMessage: render,
      onStatus: (online) => (status.textContent = online ? STATUS_ONLINE : STATUS_OFFLINE),
    },
  );
  link.start();

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    if (link.send(crypto.randomUUID(), { kind: "text", text })) input.value = "";
  });
}
