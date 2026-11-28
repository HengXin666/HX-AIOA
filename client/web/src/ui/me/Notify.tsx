import { Switch } from "@hx/ui/ui/switch";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Group } from "./parts";

type PushState = "unsupported" | "denied" | "off" | "on" | string;
type PushModule = {
  pushSupported: () => boolean;
  pushState: () => Promise<PushState> | PushState;
  enablePush: () => Promise<unknown>;
  disablePush: () => Promise<unknown>;
};
// Web Push 由 core/push.ts 提供 (W3, 另行实现); 文件不存在时 glob 为空, 整组不显示
const pushModules = import.meta.glob<PushModule>("../../core/push.ts");
const loadPush = pushModules["../../core/push.ts"];

export default function Notify() {
  const [mod, setMod] = useState<PushModule | null>(null);
  const [state, setState] = useState<PushState>("off");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void loadPush?.().then(async (m) => {
      if (!m.pushSupported()) return;
      setMod(m);
      setState(await m.pushState());
    });
  }, []);
  if (!mod) return <Group title="通知"><p className="text-sm text-muted-foreground">这个浏览器不支持 Web Push, 只在页面开着时收到消息。</p></Group>;
  const toggle = async (on: boolean) => {
    setBusy(true);
    try {
      await (on ? mod.enablePush() : mod.disablePush());
      setState(await mod.pushState());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Group title="通知">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-foreground">页面关闭时也推送通知</span>
        <Switch checked={state === "on"} disabled={busy || state === "denied" || state === "unconfigured"} onCheckedChange={(v) => void toggle(v)} />
      </div>
      <p className="text-xs text-muted-foreground">
        {state === "denied" ? "浏览器已拒绝通知权限, 请在站点设置里放开。" : state === "unconfigured" ? "服务端没有配置 Web Push (VAPID)。" : "浏览器进程没在运行时收不到; Chrome 的推送服务在 FCM, 大陆网络需要自己的代理。"}
      </p>
    </Group>
  );
}

