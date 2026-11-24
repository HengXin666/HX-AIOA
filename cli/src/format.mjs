// 消息的人读格式: "#seq 名字: 正文"; --json 时一行一条原样 Envelope
export function textOf(ev) {
  const d = ev.data ?? {};
  if (ev.kind === "report") return [d.title, d.summary].filter(Boolean).join("\n");
  if (d.summary && d.title && d.summary.startsWith(d.title)) return d.summary;
  return [d.title, d.summary].filter(Boolean).join("\n");
}

export function line(ev) {
  if (ev.deleted) return `#${ev.seq} [${ev.deleted.mode === "recall" ? "撤回" : "删除"}] 原消息 #${ev.deleted.seq}`;
  const who = ev.source?.name || ev.source?.id || "?";
  const reply = ev.reply ? ` (回复 #${ev.reply.seq})` : "";
  const time = new Date(ev.ts).toLocaleString("zh-CN", { hour12: false });
  return `#${ev.seq} ${time} ${who}${reply}: ${textOf(ev)}`;
}

export function print(ev, json) {
  process.stdout.write(`${json ? JSON.stringify(ev) : line(ev)}\n`);
}

/** 是不是自己 (这把 key 的来源) 发的。 */
export const isMine = (ev, me) => !!me?.sourceId && ev.source?.id === me.sourceId;
