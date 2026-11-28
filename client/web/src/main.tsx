import { MotionProvider } from "@hx/ui/motion";
import { ThemeProvider } from "@hx/ui/theme";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { watchVersion } from "./core/version";
import "./index.css";

watchVersion();
// Service Worker 与 Web Push 由 core/push.ts 提供 (W3); 该文件不存在时这里什么都不做
const push = import.meta.glob<{ registerSW?: () => unknown; syncPush?: () => Promise<void> }>("./core/push.ts");
// 注册 SW; 浏览器自己换过订阅时重报一次 (未登录或没开通知时 syncPush 什么也不做)
void push["./core/push.ts"]?.().then(async (m) => {
  await m.registerSW?.();
  await m.syncPush?.().catch(() => undefined);
});
// dev 下 ?agmock: 不登录直接看 Agent GUI 工作台 (内存模拟主机), 生产包里这段被剔除
const DevHarness = import.meta.env.DEV && location.search.includes("agmock") ? lazy(() => import("./agentgui/dev-harness")) : null;
const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <ThemeProvider defaultMode="system">
        {/* HX-UI 的动效组件 (图表, 骨架, 弹层) 一律用 m.*, 要根部的 MotionProvider 加载特性, 否则停在初始态 */}
        <MotionProvider>
          {DevHarness ? (
            <Suspense fallback={null}>
              <DevHarness />
            </Suspense>
          ) : (
            <App />
          )}
        </MotionProvider>
      </ThemeProvider>
    </StrictMode>,
  );
}
