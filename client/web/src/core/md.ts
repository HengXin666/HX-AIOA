const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function inline(s: string): string {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

// 报告阅读用的极简 Markdown: 标题, 列表, 引用, 段落; 先转义再替换, 不信任来源
export function markdown(src: string): string {
  const out: string[] = [];
  let list = false;
  const close = () => {
    if (list) out.push("</ul>");
    list = false;
  };
  for (const raw of src.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const head = line.match(/^(#{1,3})\s+(.*)$/);
    if (head) {
      close();
      const lv = head[1]!.length + 2;
      out.push(`<h${lv}>${inline(head[2]!)}</h${lv}>`);
    } else if (/^[-*]\s+/.test(line)) {
      if (!list) out.push("<ul>");
      list = true;
      out.push(`<li>${inline(line.replace(/^[-*]\s+/, ""))}</li>`);
    } else if (line.startsWith(">")) {
      close();
      out.push(`<blockquote>${inline(line.slice(1).trim())}</blockquote>`);
    } else if (line) {
      close();
      out.push(`<p>${inline(line)}</p>`);
    } else close();
  }
  close();
  return out.join("");
}
