import type { MailInfo } from "@hx-aioa/protocol";
import { Badge } from "@hx/ui/ui/badge";
import { Button } from "@hx/ui/ui/button";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@hx/ui/ui/command";
import { Copy, Languages, Send, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { chats, titleOf, type Message } from "../../../core/chats";
import { EXTERNAL, LOCALE, TXT_LOADING } from "../../../core/constants";
import { mailBody, mailForward } from "../../../core/mail";
import { translateHtml, trLangOf } from "../../../core/mail-translate";
import { PageHeader } from "../../kit/Panes";
import { UserAvatar } from "../../UserAvatar";

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
const copy = (text: string, ok: string) => void navigator.clipboard.writeText(text).then(() => toast.success(ok));

// 邮件详情 (对照安卓 ch-maildetail): 验证码, 要点, 关键链接, 正文 (沙箱, 不跑脚本), 外文给翻译条, 可转进群
export function MailDetail({ m, back }: { m: Message; back?: () => void }) {
  const d = m.kind === "event" ? m.data : null;
  const mail = d?.mail as MailInfo | undefined;
  const [html, setHtml] = useState<string | null>(null);
  const [tr, setTr] = useState<{ on: boolean; html?: string; busy?: boolean }>({ on: false });
  const [fwd, setFwd] = useState(false);

  useEffect(() => {
    setHtml(null);
    setTr({ on: false });
    if (!mail?.body) return setHtml(`<pre style="white-space:pre-wrap;font:inherit">${esc(d?.summary ?? "")}</pre>`);
    mailBody(m.id)
      .then(setHtml)
      .catch((e: Error) => setHtml(`<p>${esc(e.message)}</p>`));
  }, [m.id, mail?.body, d?.summary]);

  if (!d || !mail) return null;
  const lang = html ? trLangOf(html) : null;
  const toggle = async () => {
    if (tr.on) return setTr({ ...tr, on: false });
    if (tr.html) return setTr({ ...tr, on: true });
    setTr({ on: false, busy: true });
    try {
      setTr({ on: true, html: await translateHtml(html!) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      setTr({ on: false });
    }
  };
  const shown = tr.on && tr.html ? tr.html : html;
  const doc = shown && `<!doctype html><meta charset="utf-8"><base target="_blank"><style>body{margin:12px;font:14px system-ui;color-scheme:light dark}img{max-width:100%;height:auto}</style>${shown}`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title={d.title || "(无主题)"} sub={mail.vendor} back={back} actions={<Button size="icon-sm" variant="ghost" aria-label="转进群" title="转进群" onClick={() => setFwd(true)}><Send /></Button>} />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <div className="flex items-center gap-3">
          <UserAvatar name={mail.name || mail.vendor || mail.from} />
          <div className="min-w-0 flex-1 text-sm">
            <p className="truncate text-foreground">{mail.name ? `${mail.name} <${mail.from}>` : mail.from}</p>
            <p className="truncate text-xs text-muted-foreground">
              {mail.to ? `收件 ${mail.to}` : ""}
              {mail.list ? ` · 经 ${mail.list}` : ""} · {new Date(m.ts).toLocaleString(LOCALE)}
            </p>
          </div>
        </div>
        {mail.spoof && (
          <p className="flex items-center gap-2 rounded-lg bg-destructive/10 p-2 text-sm text-destructive [&_svg]:size-4">
            <ShieldAlert />
            发件域名校验失败, 可能是冒充
          </p>
        )}
        {(mail.otp?.code ?? mail.code) && (
          <button type="button" onClick={() => copy(mail.otp?.code ?? mail.code!, "验证码已复制")} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 text-left">
            <span className="font-mono text-2xl font-semibold tracking-widest text-foreground">{mail.otp?.code ?? mail.code}</span>
            <span className="text-xs text-muted-foreground">{mail.otp?.expiresAt ? `${new Date(mail.otp.expiresAt).toLocaleTimeString(LOCALE)} 前有效 · ` : ""}点击复制</span>
            <Copy className="ml-auto size-4 text-muted-foreground" />
          </button>
        )}
        {mail.brief && <p className="text-sm text-foreground">{mail.brief}</p>}
        {!!mail.facts?.length && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            {mail.facts.map((f) => (
              <div key={f.label} className="contents">
                <dt className="text-muted-foreground">{f.label}</dt>
                <dd className="break-words text-foreground">{f.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {!!mail.links?.length && (
          <div className="flex flex-wrap gap-2">
            {mail.links.map((l) => (
              <Button key={l.url} asChild size="sm" variant="outline">
                <a href={l.url} {...EXTERNAL}>
                  {l.label}
                </a>
              </Button>
            ))}
          </div>
        )}
        {lang && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground [&_svg]:size-4">
            <Languages />
            <span className="flex-1">{tr.on ? `已从${lang}翻译` : `这是一封${lang}邮件`}</span>
            <Button size="sm" variant="ghost" disabled={tr.busy} onClick={() => void toggle()}>
              {tr.busy ? "翻译中" : tr.on ? "看原文" : "翻译"}
            </Button>
          </div>
        )}
        {doc ? (
          <iframe title="邮件正文" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={doc} className="min-h-[60vh] w-full flex-1 rounded-lg border border-border bg-background" />
        ) : (
          <p className="text-sm text-muted-foreground">{TXT_LOADING}</p>
        )}
        {d.url && (
          <a href={d.url} {...EXTERNAL} className="text-xs text-brand underline-offset-2 hover:underline">
            打开原文链接
          </a>
        )}
        <div className="flex gap-2">
          <Badge variant="secondary">{mail.category ?? mail.vendor}</Badge>
        </div>
      </div>
      {fwd && <PickChat onPick={(c) => void mailForward(m.id, c).then(() => toast.success(`已转到 ${titleOf(chats.meta(c) ?? { channel: c, updated: 0 })}`)).catch((e: Error) => toast.error(e.message))} onClose={() => setFwd(false)} />}
    </div>
  );
}

function PickChat({ onPick, onClose }: { onPick: (channel: string) => void; onClose: () => void }) {
  return (
    <CommandDialog open onOpenChange={(o) => !o && onClose()} title="转进群" description="选择会话">
      <CommandInput placeholder="转进群..." />
      <CommandList>
        <CommandEmpty>没有匹配的会话</CommandEmpty>
        <CommandGroup heading="转进群">
          {chats
            .ordered()
            .filter((c) => c.view !== "mail")
            .map((c) => (
              <CommandItem
                key={c.channel}
                value={`${titleOf(c)} ${c.channel}`}
                onSelect={() => {
                  onClose();
                  onPick(c.channel);
                }}
              >
                <UserAvatar id={c.avatar} name={titleOf(c)} size="sm" />
                {titleOf(c)}
              </CommandItem>
            ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
