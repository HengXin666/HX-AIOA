import { Button } from "@hx/ui/ui/button";
import { Field } from "@hx/ui/ui/field";
import { Input } from "@hx/ui/ui/input";
import { useEffect, useState, type FormEvent } from "react";
import { login, setupDone } from "../core/auth";
import { ApkHint } from "./ApkHint";

export function Login() {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState(false);

  useEffect(() => {
    void setupDone().then((done) => setFresh(!done));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(name.trim(), password);
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
          <h1 className="text-lg font-semibold text-foreground">登录 HX-AIOA</h1>
          <p className="text-sm text-muted-foreground">用安卓 App 上同一个账号登录。</p>
        </div>
        {fresh && <p className="text-sm text-muted-foreground">服务端还没初始化, 先在安卓 App 里用初始化码创建主人账号。</p>}
        <Field label="账号">
          <Input autoComplete="username" value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="密码" error={error ?? undefined}>
          <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <Button type="submit" disabled={busy || !name || !password}>
          {busy ? "登录中" : "登录"}
        </Button>
      </form>
      <ApkHint />
    </div>
  );
}
