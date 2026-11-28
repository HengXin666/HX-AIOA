import {
  PATH_INTEGRATIONS,
  PATH_KEYS,
  PATH_SOURCE_TYPES,
  PATH_SOURCES,
  type Integration,
  type SourceCreated,
  type SourceInfo,
  type SourceInput,
  type SourceTypeInfo,
} from "@hx-aioa/protocol";
import { Badge } from "@hx/ui/ui/badge";
import { Button } from "@hx/ui/ui/button";
import { ConfirmDialog } from "@hx/ui/ui/confirm-dialog";
import { Field } from "@hx/ui/ui/field";
import { Input } from "@hx/ui/ui/input";
import { Copy, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "../../core/auth";
import { LOCALE, TXT_LOADING } from "../../core/constants";
import { shortTime } from "../ChatList";
import { errText, Group } from "./parts";

const KIND = { push: "推送", interactive: "交互 Agent", probe: "探针", other: "其他" } as const;
const copy = (t: string) => void navigator.clipboard.writeText(t).then(() => toast.success("已复制"));
const withKey = (url: string, key: string) => `${url}${url.includes("?") ? "&" : "?"}key=${encodeURIComponent(key)}`;

// 数据源与接入总览 (对照安卓 me-src / me-src-add / me-src-done / me-integ, 主人可见)
export default function Sources() {
  const [sources, setSources] = useState<SourceInfo[] | null>(null);
  const [integ, setInteg] = useState<Integration[]>([]);
  const [adding, setAdding] = useState(false);
  const [done, setDone] = useState<SourceCreated | null>(null);
  const reload = () => {
    void api<{ sources: SourceInfo[] }>(PATH_SOURCES).then((r) => setSources(r.sources), (e) => toast.error(errText(e)));
    void api<{ integrations: Integration[] }>(PATH_INTEGRATIONS).then((r) => setInteg(r.integrations), () => undefined);
  };
  useEffect(reload, []);

  if (done) return <Done s={done} onClose={() => setDone(null)} />;
  if (adding)
    return (
      <Add
        onCancel={() => setAdding(false)}
        onCreated={(s) => {
          setAdding(false);
          setDone(s);
          reload();
        }}
      />
    );
  return (
    <>
      <Button size="sm" onClick={() => setAdding(true)}>
        <Plus />
        添加数据源
      </Button>
      <Group title={`数据源${sources ? ` (${sources.length})` : ""}`}>
        {!sources && <p className="text-sm text-muted-foreground">{TXT_LOADING}</p>}
        {sources?.length === 0 && <p className="text-sm text-muted-foreground">还没有数据源</p>}
        {sources?.map((s) => (
          <div key={s.id} className="flex items-center gap-2 text-sm">
            <div className="min-w-0 flex-1">
              <p className="truncate text-foreground">{s.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {s.type}
                {s.channel ? ` · 进 ${s.channel}` : ""}
                {s.subject ? ` · ${s.subject}` : ""} · {new Date(s.created).toLocaleDateString(LOCALE)}
              </p>
            </div>
            <ConfirmDialog
              trigger={<Button size="icon-xs" variant="ghost" aria-label="删除"><Trash2 /></Button>}
              title={`删除 ${s.name}?`}
              description="删除后这个来源推来的消息会被拒收, 已有消息保留。"
              confirmLabel="删除"
              tone="destructive"
              onConfirm={() => api(`${PATH_SOURCES}/${encodeURIComponent(s.id)}`, { method: "DELETE" }).then(reload)}
            />
          </div>
        ))}
      </Group>
      <Group title="接入总览 (每把 key 一行)">
        {integ.map((i) => (
          <div key={i.keyId} className="flex items-center gap-2 text-sm">
            <div className="min-w-0 flex-1">
              <p className="truncate text-foreground">{i.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {i.prefix}… · {i.lastActive ? `${shortTime(i.lastActive)} 活跃` : "没用过"}
                {i.agents.length ? ` · ${i.agents.map((a) => `${a.name}${a.online ? " 在线" : ""}`).join(", ")}` : ""}
              </p>
            </div>
            <Badge variant="secondary">{KIND[i.kind]}</Badge>
            <ConfirmDialog
              trigger={<Button size="icon-xs" variant="ghost" aria-label="作废 key"><Trash2 /></Button>}
              title={`作废 ${i.name} 的 key?`}
              description="用这把 key 的推送和 Agent 会立刻失去访问权。"
              confirmLabel="作废"
              tone="destructive"
              onConfirm={() => api(`${PATH_KEYS}/${encodeURIComponent(i.keyId)}`, { method: "DELETE" }).then(reload)}
            />
          </div>
        ))}
        {!integ.length && <p className="text-sm text-muted-foreground">没有接入</p>}
      </Group>
    </>
  );
}

function Add({ onCancel, onCreated }: { onCancel: () => void; onCreated: (s: SourceCreated) => void }) {
  const [types, setTypes] = useState<SourceTypeInfo[]>([]);
  const [type, setType] = useState<SourceTypeInfo | null>(null);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [channel, setChannel] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void api<{ types: SourceTypeInfo[] }>(PATH_SOURCE_TYPES).then((r) => setTypes(r.types.filter((t) => t.adapter)), (e) => toast.error(errText(e)));
  }, []);
  const pick = (t: SourceTypeInfo) => {
    setType(t);
    setName(t.name);
    setSubject(t.subject ?? "");
    setChannel(t.channel ?? "");
  };
  const create = async () => {
    if (!type) return;
    setBusy(true);
    try {
      const body: SourceInput = { name: name.trim(), type: type.type, key: {} };
      if (subject.trim()) body.subject = subject.trim();
      if (channel.trim()) body.channel = channel.trim();
      if (type.rules) body.rules = type.rules;
      onCreated(await api<SourceCreated>(PATH_SOURCES, { method: "POST", body: JSON.stringify(body) }));
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Group title="添加数据源">
      <div className="flex flex-wrap gap-2">
        {types.map((t) => (
          <Button key={t.type} size="sm" variant={type?.type === t.type ? "secondary" : "outline"} onClick={() => pick(t)}>
            {t.name}
          </Button>
        ))}
      </div>
      {type && (
        <>
          <Field label="名字">
            <Input size="sm" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={type.type === "github" ? "仓库 (owner/repo, 可选)" : "主体 (可选)"}>
            <Input size="sm" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </Field>
          <Field label="进哪个群 (可选, 不填按来源名)">
            <Input size="sm" value={channel} onChange={(e) => setChannel(e.target.value)} />
          </Field>
        </>
      )}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          取消
        </Button>
        <Button size="sm" disabled={!type || !name.trim() || busy} onClick={() => void create()}>
          创建并生成 key
        </Button>
      </div>
    </Group>
  );
}

// 接入结果: key 与 webhookSecret 只显示这一次
function Done({ s, onClose }: { s: SourceCreated; onClose: () => void }) {
  const k = s.key;
  const urls = Object.entries(k?.webhookUrls ?? {});
  const lines: [string, string][] = k ? [...urls.map(([a, u]) => [`Webhook 地址 (${a}, 带 key)`, withKey(u, k.key)] as [string, string]), ["key", k.key]] : [];
  if (k?.webhookSecret) lines.push(["webhookSecret (支持 HMAC 签名的系统用)", k.webhookSecret]);
  return (
    <Group title={`接入 ${s.name}`}>
      <p className="text-xs text-warning">key 只显示这一次, 先复制保存好。</p>
      {lines.map(([label, v]) => (
        <div key={label} className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{label}</span>
          <button type="button" onClick={() => copy(v)} className="flex items-center gap-2 rounded-md bg-muted px-2 py-1.5 text-left font-mono text-xs break-all text-foreground">
            <span className="flex-1">{v}</span>
            <Copy className="size-3.5 shrink-0" />
          </button>
        </div>
      ))}
      <Button size="sm" onClick={onClose}>
        完成
      </Button>
    </Group>
  );
}
