import { useTheme } from "@hx/ui/theme";
import { Button } from "@hx/ui/ui/button";
import { Switch } from "@hx/ui/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@hx/ui/ui/toggle-group";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useLinkState, useUser } from "../app/hooks";
import { logout } from "../core/auth";
import { link } from "../core/link";

const MODES = [
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
  { value: "system", label: "跟随系统" },
] as const;
const LINK_TEXT = { idle: "未连接", connecting: "连接中", online: "已连接", offline: "重连中" } as const;
const MODE_TEXT = { worker: "多标签共用 (SharedWorker)", leader: "多标签共用 (本标签持有)", follower: "多标签共用 (其他标签持有)", direct: "本页独占" } as const;

export default function Settings() {
  const user = useUser();
  const state = useLinkState();
  const { mode, setMode } = useTheme();
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-3 pb-6">
        <h2 className="text-base font-semibold text-foreground">设置</h2>
        <Group title="账号">
          <Row label={user?.display ?? ""} value={user?.name ?? ""} />
          <Row label="连接" value={LINK_TEXT[state]} />
          {link.mode && <Row label="连接方式" value={MODE_TEXT[link.mode]} />}
          <Button variant="outline" onClick={() => void logout()}>
            退出登录
          </Button>
        </Group>
        <Group title="外观">
          <ToggleGroup type="single" variant="outline" value={mode} onValueChange={(v) => v && setMode(v as (typeof MODES)[number]["value"])}>
            {MODES.map((m) => (
              <ToggleGroupItem key={m.value} value={m.value}>
                {m.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Group>
        <Notify />
        <Group title="快捷键">
          <Row label="命令面板 (搜会话, 跳页面)" value="Ctrl+K" />
          <Row label="上一个 / 下一个会话" value="Alt+↑ / Alt+↓" />
          <Row label="关闭群资料" value="Esc" />
        </Group>
        <Group title="关于">
          <Row label="Web 版本" value={`${__WEB_BUILD__.web} (${__WEB_BUILD__.sha})`} />
          <p className="text-xs text-muted-foreground">代理请用系统或浏览器自己的; 链接都从新标签页打开。可从浏览器菜单 "安装" 或 "添加到主屏幕"。</p>
        </Group>
      </div>
    </div>
  );
}

type PushState = "unsupported" | "denied" | "off" | "on" | string;
type PushModule = {
  pushSupported: () => boolean;
  pushState: () => Promise<PushState> | PushState;
  enablePush: () => Promise<unknown>;
  disablePush: () => Promise<unknown>;
};
// Web Push 由 core/push.ts 提供 (W3, 另行实现); 文件不存在时 glob 为空, 整组不显示
const pushModules = import.meta.glob<PushModule>("../core/push.ts");
const loadPush = pushModules["../core/push.ts"];

function Notify() {
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
  if (!mod) return null;
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

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-foreground">{label}</span>
      <span className="text-right text-muted-foreground">{value}</span>
    </div>
  );
}
