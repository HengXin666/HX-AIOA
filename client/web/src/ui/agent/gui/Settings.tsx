import { Button } from "@hx/ui/ui/button";
import { Card } from "@hx/ui/ui/card";
import { Field } from "@hx/ui/ui/field";
import { Input } from "@hx/ui/ui/input";
import { RadioGroup, RadioGroupCard } from "@hx/ui/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@hx/ui/ui/select";
import { Textarea } from "@hx/ui/ui/textarea";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useResources } from "../../../app/hooks";
import { STORAGE_AG_MOCK as STORAGE_MOCK } from "../../../agentgui/constants";
import { useAgHub, useConn, usePairs } from "../../../agentgui/hooks";
import { allPairs, pairHost, removePair, routeBlock } from "../../../agentgui/pairs";
import type { Device, Instance, Settings, WatchPush } from "../../../agentgui/types";
import { conn } from "../../../agentgui/conns";
import { ago } from "./parts";

// 预设: 首次启动探针也会写入, 这里方便再加一个同类实例
const PRESETS: Omit<Instance, "id">[] = [
  { name: "Claude Code", kind: "claude", cmd: "npx", args: ["-y", "@agentclientprotocol/claude-agent-acp"] },
  { name: "Codex", kind: "codex", cmd: "npx", args: ["-y", "@agentclientprotocol/codex-acp"] },
  { name: "DSH", kind: "dsh", cmd: "npx", args: ["-y", "@openma/deepseek-harness-acp"] },
];
const WATCH: { value: WatchPush; title: string; desc: string }[] = [
  { value: "quiet", title: "静默推送", desc: "手机只进收件箱, 无声无震动; 60 秒没人答再正常推一次" },
  { value: "none", title: "不推", desc: "电脑前看着时手机什么都不收" },
  { value: "normal", title: "正常推送", desc: "照常有声推送" },
];

function Section({ title, children, sub }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div>
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
      {children}
    </Card>
  );
}

// 设置: 配对, Agent 实例, 已配对设备, 电脑前看着时手机; 除配对外都存在探针本地, 经直连读写
export function SettingsPage({ host }: { host: string }) {
  const c = useConn(host);
  const ready = c.state === "ready";
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
        <h2 className="text-xl font-semibold text-foreground">Agent GUI 设置</h2>
        <PairSection />
        {!host ? null : !ready ? (
          <p className="text-sm text-muted-foreground">{host}: 连上主机后可以管理 Agent 实例, 设备与推送 (这些都存在主机本地)</p>
        ) : (
          <>
            <Instances host={host} list={c.instances} />
            <Watch host={host} settings={c.settings} />
            <Devices host={host} />
          </>
        )}
        {import.meta.env.DEV && <DevMock />}
      </div>
    </div>
  );
}

function PairSection() {
  usePairs();
  const hub = useAgHub();
  const { probes, hosts } = useResources();
  const candidates = [...new Set([...hub.hosts.map((h) => h.subject), ...probes, ...hosts.map((h) => h.subject)])].sort();
  const [subject, setSubject] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!subject || !password) return;
    setBusy(true);
    try {
      const p = await pairHost(subject, password);
      toast.success(`已配对 ${p.host}`);
      setPassword("");
      conn(p.host).kick();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title="配对这台主机" sub="经 Hub 一次, 要主账号密码; 之后浏览器直连探针, 不再经过 Hub">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="主机" className="w-56">
          <Select value={subject} onValueChange={setSubject}>
            <SelectTrigger>
              <SelectValue placeholder="选择主机" />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((h) => (
                <SelectItem key={h} value={h}>
                  {h}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="密码" className="w-56">
          <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void go()} />
        </Field>
        <Button onClick={() => void go()} disabled={busy || !subject || !password}>
          {busy ? "配对中" : "配对"}
        </Button>
      </div>
      {allPairs().map((p) => (
        <div key={p.host} className="flex items-center gap-2 text-sm">
          <span className="min-w-0 flex-1 truncate text-foreground">{p.host}</span>
          <span className="truncate text-xs text-muted-foreground">{p.routes.map((r) => (routeBlock(r) ? `${r.url} (此设备不可用: ${routeBlock(r)})` : r.url)).join(", ") || "没有直连路线"}</span>
          <Button size="sm" variant="ghost" onClick={() => removePair(p.host)}>
            忘记
          </Button>
        </div>
      ))}
    </Section>
  );
}

const blank = (): Instance => ({ id: "", name: "", kind: "custom", cmd: "", args: [] });

function Instances({ host, list }: { host: string; list: Instance[] }) {
  const c = conn(host);
  const [edit, setEdit] = useState<Instance | null>(null);
  const save = (it: Instance) =>
    void c
      .hx<Instance[]>("instances/save", it)
      .then((l) => {
        c.setInstances(l);
        setEdit(null);
      })
      .catch((e: Error) => toast.error(e.message));
  const del = (id: string) =>
    void c
      .hx<Instance[]>("instances/delete", { id })
      .then((l) => c.setInstances(l))
      .catch((e: Error) => toast.error(e.message));
  return (
    <Section title="Agent 实例" sub="ACP 启动命令 + 参数 + 环境变量; 同一种 Agent 可建多个实例">
      {list.map((it) => (
        <div key={it.id} className="flex items-center gap-2 text-sm">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-foreground">{it.name}</span>
            <span className="block truncate font-mono text-xs text-muted-foreground">{[it.cmd, ...it.args].join(" ")}</span>
          </span>
          <Button size="sm" variant="ghost" onClick={() => setEdit(it)}>
            编辑
          </Button>
          <Button size="sm" variant="ghost" onClick={() => confirm(`删除实例 "${it.name}"?`) && del(it.id)}>
            删除
          </Button>
        </div>
      ))}
      {edit ? (
        <InstanceForm init={edit} onSave={save} onCancel={() => setEdit(null)} />
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setEdit(blank())}>
            自定义命令
          </Button>
          {PRESETS.map((p) => (
            <Button key={p.name} size="sm" variant="outline" onClick={() => setEdit({ ...p, id: "" })}>
              + {p.name}
            </Button>
          ))}
        </div>
      )}
    </Section>
  );
}

function InstanceForm({ init, onSave, onCancel }: { init: Instance; onSave: (i: Instance) => void; onCancel: () => void }) {
  const [it, setIt] = useState(init);
  const [args, setArgs] = useState(init.args.join(" "));
  const [env, setEnv] = useState(Object.entries(init.env ?? {}).map(([k, v]) => `${k}=${v}`).join("\n"));
  const submit = () => {
    const envObj: Record<string, string> = {};
    for (const line of env.split("\n")) {
      const k = line.indexOf("=");
      if (k > 0) envObj[line.slice(0, k).trim()] = line.slice(k + 1).trim();
    }
    const id = it.id || `${it.kind}-${Date.now().toString(36)}`;
    onSave({ ...it, id, args: args.split(/\s+/).filter(Boolean), env: Object.keys(envObj).length ? envObj : undefined, model: it.model || undefined, mode: it.mode || undefined });
  };
  const set = (p: Partial<Instance>) => setIt({ ...it, ...p });
  return (
    <div className="grid grid-cols-2 gap-3 rounded-lg border border-border p-3">
      <Field label="显示名">
        <Input value={it.name} onChange={(e) => set({ name: e.target.value })} />
      </Field>
      <Field label="种类">
        <Select value={it.kind} onValueChange={(v) => set({ kind: v as Instance["kind"] })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {["claude", "codex", "dsh", "custom"].map((k) => (
              <SelectItem key={k} value={k}>
                {k}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="命令">
        <Input className="font-mono" value={it.cmd} onChange={(e) => set({ cmd: e.target.value })} />
      </Field>
      <Field label="参数 (空格分隔)">
        <Input className="font-mono" value={args} onChange={(e) => setArgs(e.target.value)} />
      </Field>
      <Field label="默认模型">
        <Input value={it.model ?? ""} onChange={(e) => set({ model: e.target.value })} />
      </Field>
      <Field label="默认权限模式">
        <Input value={it.mode ?? ""} onChange={(e) => set({ mode: e.target.value })} />
      </Field>
      <Field label="环境变量 (每行 KEY=值)" className="col-span-2">
        <Textarea className="font-mono" rows={3} value={env} onChange={(e) => setEnv(e.target.value)} />
      </Field>
      <div className="col-span-2 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          取消
        </Button>
        <Button onClick={submit} disabled={!it.name.trim() || !it.cmd.trim()}>
          保存
        </Button>
      </div>
    </div>
  );
}

function Watch({ host, settings }: { host: string; settings: Settings | null }) {
  const c = conn(host);
  const set = (v: string) =>
    void c
      .hx<Settings>("settings/set", { watchPush: v })
      .then((s) => c.setSettings(s))
      .catch((e: Error) => toast.error(e.message));
  return (
    <Section title="电脑前看着时手机" sub="有页面在前台看着这个会话时, 审批请求怎么推到手机">
      <RadioGroup value={settings?.watchPush ?? "quiet"} onValueChange={set}>
        {WATCH.map((w) => (
          <RadioGroupCard key={w.value} value={w.value} title={w.title} description={w.desc} />
        ))}
      </RadioGroup>
    </Section>
  );
}

function Devices({ host }: { host: string }) {
  const c = conn(host);
  const [list, setList] = useState<Device[] | null>(null);
  useEffect(() => {
    void c.hx<Device[]>("devices/list").then(setList).catch((e: Error) => toast.error(e.message));
  }, [c]);
  const remove = (id: string) =>
    void c
      .hx<Device[]>("devices/remove", { id })
      .then(setList)
      .catch((e: Error) => toast.error(e.message));
  return (
    <Section title="已配对设备" sub="删掉后那台设备不能再直连这台主机">
      {list === null && <p className="text-sm text-muted-foreground">加载中</p>}
      {list?.map((d) => (
        <div key={d.id} className="flex items-center gap-2 text-sm">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-foreground">{d.name}</span>
            <span className="block text-xs text-muted-foreground">
              {d.id} · 配对于 {ago(d.added)}前{d.last ? ` · 最近 ${ago(d.last)}前` : ""}
            </span>
          </span>
          <Button size="sm" variant="ghost" onClick={() => confirm(`删除设备 "${d.name}"?`) && remove(d.id)}>
            删除
          </Button>
        </div>
      ))}
    </Section>
  );
}

function DevMock() {
  const [on, setOn] = useState(localStorage.getItem(STORAGE_MOCK) === "1");
  return (
    <Section title="开发: 模拟主机" sub="只在 vite dev 下出现; 内存里的模拟探针, 刷新页面生效">
      <Button
        variant="outline"
        onClick={() => {
          localStorage.setItem(STORAGE_MOCK, on ? "0" : "1");
          setOn(!on);
          location.reload();
        }}
      >
        {on ? "关掉模拟主机" : "打开模拟主机"}
      </Button>
    </Section>
  );
}
