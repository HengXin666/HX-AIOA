import { useEffect, useRef, useState } from "react";

type Conn = { saveData?: boolean; effectiveType?: string };
const SLOW = new Set(["slow-2g", "2g", "3g"]);
const IDLE_TIMEOUT = 1500;

// 3D 视图何时加载: 卡片进入视口, 浏览器空闲; 省流量或慢网直接不加载, 给一句说明。
export function useLight3D() {
  const ref = useRef<HTMLDivElement>(null);
  const conn = (navigator as Navigator & { connection?: Conn }).connection;
  const reason = conn?.saveData ? "省流量模式下不加载 3D 视图" : conn?.effectiveType && SLOW.has(conn.effectiveType) ? "网速较慢, 先不加载 3D 视图" : "";
  const [ok, setOk] = useState(false);
  useEffect(() => {
    if (reason || !ref.current) return;
    let idle: number = 0;
    const io = new IntersectionObserver((es) => {
      if (!es.some((e) => e.isIntersecting)) return;
      io.disconnect();
      const go = () => setOk(true);
      idle = typeof requestIdleCallback === "function" ? requestIdleCallback(go, { timeout: IDLE_TIMEOUT }) : setTimeout(go, 0);
    });
    io.observe(ref.current);
    return () => {
      io.disconnect();
      if (typeof cancelIdleCallback === "function") cancelIdleCallback(idle);
    };
  }, [reason]);
  return { ref, ok, reason };
}
