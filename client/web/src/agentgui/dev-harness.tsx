import { Toaster } from "@hx/ui/ui/sonner";
import { useLayout } from "../app/hooks";
import { useLoc } from "../app/router";
import { useEffect, useState } from "react";
import AgentGui from "../ui/agent/gui";
import { deviceKey } from "./keys";
import { putPair } from "./pairs";

// ?agpair=<地址>: 联调用, 绕过 Hub 直接让本地探针脚本登记这台浏览器 (脚本在 /pair 上调 ag_pair)
async function devPair(url: string): Promise<void> {
  const k = await deviceKey();
  const r = await fetch(`${url}/pair`, { method: "POST", body: JSON.stringify({ id: k.id, name: "dev 浏览器", pub: k.pub }) });
  const p = (await r.json()) as { host: string; pub: JsonWebKey; routes: { kind: "local"; url: string }[] };
  putPair({ host: p.host, pub: p.pub, routes: p.routes, at: Date.now() });
}

// 只在 vite dev 且地址带 ?agmock 时由 main.tsx 加载: 不登录, 直接用内存模拟主机看工作台
export default function DevHarness() {
  const loc = useLoc();
  const layout = useLayout();
  const pairUrl = new URLSearchParams(location.search).get("agpair");
  const [ready, setReady] = useState(!pairUrl);
  useEffect(() => {
    if (pairUrl) void devPair(pairUrl).finally(() => setReady(true));
  }, [pairUrl]);
  if (!ready) return null;
  return (
    <div className="flex h-full bg-background">
      <Toaster />
      <AgentGui loc={loc.area === "agent" ? loc : { area: "agent", path: ["gui"] }} layout={layout} />
    </div>
  );
}
