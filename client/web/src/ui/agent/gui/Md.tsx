import { Fragment, memo, type ReactNode } from "react";

// Agent 回答的轻量 Markdown: 代码块, 标题, 列表, 行内代码 / 粗体; 不解析 HTML
type Block = { t: "code"; lang: string; text: string } | { t: "h"; level: number; text: string } | { t: "li"; ordered: boolean; text: string } | { t: "p"; text: string };

function blocks(src: string): Block[] {
  const out: Block[] = [];
  const lines = src.split("\n");
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ t: "p", text: para.join("\n") });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const fence = /^\s*```(\S*)/.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i] as string); i++) body.push(lines[i] as string);
      out.push({ t: "code", lang: fence[1] ?? "", text: body.join("\n") });
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    const li = /^\s*([-*]|\d+[.)])\s+(.*)$/.exec(line);
    if (h) {
      flush();
      out.push({ t: "h", level: (h[1] as string).length, text: h[2] as string });
    } else if (li) {
      flush();
      out.push({ t: "li", ordered: /\d/.test(li[1] as string), text: li[2] as string });
    } else if (!line.trim()) flush();
    else para.push(line);
  }
  flush();
  return out;
}

function inline(text: string): ReactNode[] {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith("`") && p.endsWith("`") && p.length > 1)
      return (
        <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">
          {p.slice(1, -1)}
        </code>
      );
    if (p.startsWith("**") && p.endsWith("**") && p.length > 3) return <strong key={i}>{p.slice(2, -2)}</strong>;
    return <Fragment key={i}>{p}</Fragment>;
  });
}

export const Md = memo(function Md({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-2 text-[15px] leading-7 break-words text-foreground">
      {blocks(text).map((b, i) => {
        if (b.t === "code")
          return (
            <pre key={i} className="overflow-x-auto rounded-lg border border-border bg-muted p-3 font-mono text-xs leading-5">
              {b.text}
            </pre>
          );
        if (b.t === "h") return <p key={i} className="font-semibold">{inline(b.text)}</p>;
        if (b.t === "li")
          return (
            <div key={i} className="flex gap-2 pl-2">
              <span className="text-muted-foreground">{b.ordered ? "·" : "•"}</span>
              <span className="min-w-0">{inline(b.text)}</span>
            </div>
          );
        return (
          <p key={i} className="whitespace-pre-wrap">
            {inline(b.text)}
          </p>
        );
      })}
    </div>
  );
});
