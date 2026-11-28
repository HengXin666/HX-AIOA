import { useTheme } from "@hx/ui/theme";
import { Button } from "@hx/ui/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@hx/ui/ui/toggle-group";
import type { ReactNode } from "react";
import { useLinkState, useUser } from "../app/hooks";
import { logout } from "../core/auth";

const MODES = [
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
  { value: "system", label: "跟随系统" },
] as const;
const LINK_TEXT = { idle: "未连接", connecting: "连接中", online: "已连接", offline: "重连中" } as const;

export function Settings() {
  const user = useUser();
  const state = useLinkState();
  const { mode, setMode } = useTheme();
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <header className="p-3">
        <h2 className="text-base font-semibold text-foreground">设置</h2>
      </header>
      <div className="flex flex-col gap-4 px-3 pb-6">
        <Group title="账号">
          <Row label={user?.display ?? ""} value={user?.name ?? ""} />
          <Row label="连接" value={LINK_TEXT[state]} />
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
        <Group title="关于">
          <Row label="Web 版本" value={`${__WEB_BUILD__.web} (${__WEB_BUILD__.sha})`} />
          <p className="text-xs text-muted-foreground">代理请用系统或浏览器自己的; 链接都从新标签页打开。</p>
        </Group>
      </div>
    </div>
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
    <div className="flex items-center justify-between text-sm">
      <span className="text-foreground">{label}</span>
      <span className="text-muted-foreground">{value}</span>
    </div>
  );
}
