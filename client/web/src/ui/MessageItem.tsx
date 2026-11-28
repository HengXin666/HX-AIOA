import type { ReactNode } from "react";
import { textOf, type Message } from "../core/chats";
import { EXTERNAL } from "../core/constants";
import { shortTime } from "./ChatList";

const URL_RE = /(https?:\/\/[^\s<>"']+)/g;

// 站内一律新标签页打开, 不内嵌浏览器 (见 docs/design/web-arch.md 第 5 节)
function linkify(text: string): ReactNode[] {
  return text.split(URL_RE).map((part, i) =>
    i % 2 === 1 ? (
      <a key={i} href={part} {...EXTERNAL} className="break-all text-brand underline-offset-2 hover:underline">
        {part}
      </a>
    ) : (
      part
    ),
  );
}

// HTML 卡片: 沙箱 iframe, 不给脚本; 链接从新标签页打开
function HtmlCard({ html }: { html: string }) {
  const doc = `<!doctype html><meta charset="utf-8"><base target="_blank"><style>body{margin:0;font:14px system-ui;color-scheme:light dark}img{max-width:100%}</style>${html}`;
  return <iframe title="卡片" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={doc} className="h-64 w-full rounded-lg border border-border bg-background" loading="lazy" />;
}

export function MessageItem({ m, mine }: { m: Message; mine: boolean }) {
  if (m.deleted) {
    return <p className="text-center text-xs text-muted-foreground">{m.deleted.mode === "recall" ? "消息已撤回" : "消息已删除"}</p>;
  }
  const html = m.kind === "event" ? m.data.html : undefined;
  const url = m.kind === "event" ? m.data.url : undefined;
  return (
    <div className={`flex flex-col gap-1 ${mine ? "items-end" : "items-start"}`}>
      <span className="text-xs text-muted-foreground">
        {mine ? "" : `${m.source.name} · `}
        {shortTime(m.ts)}
      </span>
      <div className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ${mine ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}>
        {linkify(textOf(m))}
        {url && (
          <a href={url} {...EXTERNAL} className="mt-1 block truncate text-xs underline">
            {url}
          </a>
        )}
      </div>
      {html && <HtmlCard html={html} />}
    </div>
  );
}
