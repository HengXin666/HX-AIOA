import { Button } from "@hx/ui/ui/button";
import { Card } from "@hx/ui/ui/card";
import { LogIn } from "lucide-react";
import { useState } from "react";
import { CREATE_TIMEOUT_MS } from "../../../agentgui/constants";
import type { HostConn } from "../../../agentgui/conn";
import type { AuthNeed, Instance } from "../../../agentgui/types";

// 终端里怎么登录: 预设按种类, 自定义按命令
function loginHint(inst?: Instance): string {
  if (inst?.kind === "claude") return "claude 后输入 /login";
  if (inst?.kind === "codex") return "codex login";
  if (inst?.kind === "dsh") return "dsh (登录或配好 key)";
  return `${inst?.cmd || inst?.name || "<agent>"} login`;
}

// Agent 未登录 (探针报 auth_required): 列出 Agent 公布的登录方式, 点了走 agent/authenticate, 成功后重试
export function LoginCard({ conn, login, instance, onDone }: { conn: HostConn; login: AuthNeed; instance?: Instance; onDone?: () => void }) {
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const id = login.instance || instance?.id || "";
  const go = async (methodId: string) => {
    setBusy(methodId);
    setErr("");
    try {
      await conn.hx("agent/authenticate", { instance: id, methodId }, CREATE_TIMEOUT_MS);
      conn.clearLogin();
      onDone?.();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  return (
    <Card role="alert" className="mx-auto mb-2 flex w-full max-w-[768px] flex-col gap-3 border-warning/40 p-4">
      <div className="flex items-start gap-2">
        <LogIn className="mt-0.5 size-4 shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-foreground">{instance?.name ?? "Agent"} 还没登录</h3>
          <p className="text-xs text-muted-foreground">{login.msg}</p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => conn.clearLogin()}>
          关闭
        </Button>
      </div>
      {login.methods.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {login.methods.map((m) => (
            <Button key={m.id} size="sm" variant={m === login.methods[0] ? "default" : "outline"} disabled={Boolean(busy) || !id} onClick={() => void go(m.id)} title={m.description}>
              {busy === m.id ? "登录中" : m.name}
            </Button>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Agent 没有公布可在这里完成的登录方式。</p>
      )}
      <p className={`text-xs ${err || login.methods.length === 0 ? "text-destructive" : "text-muted-foreground"}`}>
        {err && `登录失败: ${err}。`}
        {login.methods.length > 0 && !err ? "也可以" : ""}在那台电脑的终端 (与探针同一用户) 运行 <code className="rounded bg-muted px-1 font-mono text-foreground">{loginHint(instance)}</code> 后再试。
      </p>
    </Card>
  );
}
