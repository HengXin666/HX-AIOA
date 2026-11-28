import { Button } from "@hx/ui/ui/button";
import { Field } from "@hx/ui/ui/field";
import { Input } from "@hx/ui/ui/input";
import { useEffect, useState, type FormEvent } from "react";
import { join, login, setupDone } from "../core/auth";
import { ApkHint } from "./ApkHint";

export function Login() {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState(false);
  // 邀请码注册 (对照安卓 boot-login); 链接带 ?code= 时直接进注册
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get("code") ?? "");
  const [joining, setJoining] = useState(() => Boolean(new URLSearchParams(location.search).get("code")));
  const [display, setDisplay] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void setupDone().then((done) => setFresh(!done));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!joining) await login(name.trim(), password);
      else if ((await join(code.trim(), name.trim(), password, display.trim() || undefined)) === "pending") setPending(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-6 bg-background p-6">
      <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-4 rounded-xl border border-border bg-card p-6">
        <div>
          <h1 className="text-lg font-semibold text-foreground">{joining ? "用邀请码注册" : "登录 HX-AIOA"}</h1>
          <p className="text-sm text-muted-foreground">{joining ? "邀请码由主人或管理员给你。" : "用安卓 App 上同一个账号登录。"}</p>
        </div>
        {pending && <p className="text-sm text-success">已注册, 等主人批准后再登录。</p>}
        {joining && (
          <Field label="邀请码">
            <Input value={code} onChange={(e) => setCode(e.target.value)} required />
          </Field>
        )}
        {fresh && <p className="text-sm text-muted-foreground">服务端还没初始化, 先在安卓 App 里用初始化码创建主人账号。</p>}
        <Field label="账号">
          <Input autoComplete="username" value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        {joining && (
          <Field label="昵称 (可选)">
            <Input value={display} onChange={(e) => setDisplay(e.target.value)} />
          </Field>
        )}
        <Field label="密码" error={error ?? undefined}>
          <Input type="password" autoComplete={joining ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <Button type="submit" disabled={busy || !name || !password || (joining && !code)}>
          {busy ? "请稍候" : joining ? "注册" : "登录"}
        </Button>
        <Button type="button" variant="link" size="sm" onClick={() => setJoining(!joining)}>
          {joining ? "已有账号, 去登录" : "有邀请码? 注册"}
        </Button>
      </form>
      <ApkHint />
    </div>
  );
}
