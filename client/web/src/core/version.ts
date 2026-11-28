import { VERSION_URL } from "./constants";
import { Emitter } from "./emitter";

// 部署后已打开的旧页面: 启动时, 懒加载块 404, 或回到前台时发现版本变了, 提示刷新
// 刷新前隔离上一次部署: 清掉 CacheStorage, 让 Service Worker 重新拉取, 再绕过 HTTP 缓存重载入口
export const newVersion = new Emitter<void>();
const CHECK_GAP_MS = 300_000;
const BUILD_PARAM = "v";
let checked = 0;

async function check(): Promise<void> {
  checked = Date.now();
  const res = await fetch(VERSION_URL, { cache: "no-store" }).catch(() => null);
  const v = (await res?.json().catch(() => null)) as { sha?: string } | null;
  if (v?.sha && v.sha !== __WEB_BUILD__.sha) newVersion.emit();
}

/** 清掉旧部署留下的一切缓存后重载; 地址带上时间戳, 入口 HTML 一定从服务端重新拿。 */
export async function reloadFresh(): Promise<void> {
  if ("caches" in window) {
    const keys = await caches.keys().catch(() => [] as string[]);
    await Promise.all(keys.map((k) => caches.delete(k).catch(() => false)));
  }
  if ("serviceWorker" in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations().catch(() => []);
    await Promise.all(regs.map((r) => r.update().catch(() => undefined)));
  }
  const url = new URL(location.href);
  url.searchParams.set(BUILD_PARAM, String(Date.now()));
  location.replace(url.href);
}

export function watchVersion(): void {
  if (import.meta.env.DEV) return;
  // 上次刷新带的时间戳只用一次, 去掉免得被收藏或分享
  const url = new URL(location.href);
  if (url.searchParams.has(BUILD_PARAM)) {
    url.searchParams.delete(BUILD_PARAM);
    history.replaceState(history.state, "", url.href);
  }
  window.addEventListener("vite:preloadError", (e) => {
    e.preventDefault();
    void check();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - checked > CHECK_GAP_MS) void check();
  });
  void check();
}
