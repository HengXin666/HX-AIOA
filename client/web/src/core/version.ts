import { VERSION_URL } from "./constants";
import { Emitter } from "./emitter";

// 部署后已打开的旧页面: 懒加载块 404 或回到前台时发现版本变了, 提示刷新
export const newVersion = new Emitter<void>();
const CHECK_GAP_MS = 3_600_000;
let checked = Date.now();

async function check(): Promise<void> {
  checked = Date.now();
  const res = await fetch(VERSION_URL, { cache: "no-store" }).catch(() => null);
  const v = (await res?.json().catch(() => null)) as { sha?: string } | null;
  if (v?.sha && v.sha !== __WEB_BUILD__.sha) newVersion.emit();
}

export function watchVersion(): void {
  if (import.meta.env.DEV) return;
  window.addEventListener("vite:preloadError", (e) => {
    e.preventDefault();
    void check();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - checked > CHECK_GAP_MS) void check();
  });
}
