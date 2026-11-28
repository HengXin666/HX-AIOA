import type { Envelope, MailInfo, OverviewItem } from "@hx-aioa/protocol";
import { groupOf, textOf, type Message } from "../../core/chats";
import type { Tone } from "./parts";

// 总览一层里的一条 (对照安卓 FeedMapping.toFeed): 协议对象到展示数据, 组件不认识协议
export type Row = {
  id: string;
  ids: string[];
  ev: Envelope;
  title: string;
  summary?: string;
  source: string;
  ts: number;
  tone: Tone;
  kind: "alert" | "report" | "mail" | "bell";
  count: number;
  group: string | null;
  url?: string;
  mail?: MailInfo;
  // 验证码信: 大号验证码, 剩余时间; 不放摘要
  code?: string;
  codeNote?: string;
  codeExpired?: boolean;
};

const MINUTE_MS = 60_000;
const RESOLVED = "已恢复: ";
const CARD_HINT = "卡片, 点开查看";

// 标题与摘要只要一行纯文本: 去掉 Markdown / HTML 标记
export const plain = (s: string | undefined) =>
  (s ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+])\s+/gm, "")
    .replace(/(\*\*|__|`|~~)/g, "")
    .replace(/\s+/g, " ")
    .trim();

type Data = { title?: string; summary?: string; severity?: string; url?: string; html?: string; mail?: MailInfo };

export function rowOf(it: OverviewItem, now = Date.now()): Row {
  const ev = it.ev;
  const d: Data = ev.kind === "metric" ? {} : ((ev as { data?: Data }).data ?? {});
  const resolved = Boolean((ev as { resolved?: boolean }).resolved);
  const report = ev.kind === "report";
  const sev = d.severity;
  let tone: Tone = sev === "critical" ? "danger" : sev === "warning" ? "warning" : report ? "info" : "primary";
  if (resolved) tone = "success";
  const raw = ev.kind === "metric" ? ev.source.name : (d.title ?? textOf(ev as Message).split("\n")[0] ?? "");
  const title0 = plain(raw);
  const sum = plain(d.summary);
  const row: Row = {
    id: ev.id,
    ids: it.ids,
    ev,
    title: resolved ? RESOLVED + title0 : title0,
    summary: sum && sum !== title0 ? sum : d.html ? CARD_HINT : undefined,
    source: ev.source.name,
    ts: ev.ts,
    tone,
    kind: d.mail ? "mail" : report ? "report" : tone === "danger" || tone === "warning" ? "alert" : "bell",
    count: it.count,
    group: ev.kind === "metric" ? null : groupOf(ev),
    url: d.url,
    mail: d.mail,
  };
  const mail = d.mail;
  if (!mail) return row;
  const otp = mail.otp ?? (mail.code ? { code: mail.code } : undefined);
  if (otp) {
    const left = otp.expiresAt ? otp.expiresAt - now : undefined;
    return {
      ...row,
      summary: undefined,
      code: otp.code,
      codeNote: left === undefined ? undefined : left > 0 ? `${Math.ceil(left / MINUTE_MS)} 分钟内有效` : "已过期",
      codeExpired: left !== undefined && left <= 0,
    };
  }
  if (mail.kind === "marketing") return { ...row, summary: undefined };
  return { ...row, summary: mail.brief && mail.brief !== row.title ? mail.brief : row.summary };
}
