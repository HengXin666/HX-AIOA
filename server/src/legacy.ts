import { MAX_TITLE_LENGTH, previewOfEnvelope, type Envelope, type EventData, type MsgFrame } from "@hx-aioa/protocol";

const TEXT_MARK = "text";

// 旧 text 消息 -> event 数据: 标题取首行 (截断), 原文完整放在 summary
export function textToEventData(text: string, title?: string): EventData {
  const first = (title ?? text.split("\n")[0] ?? "").slice(0, MAX_TITLE_LENGTH) || "消息";
  const data: EventData = { title: first, severity: "normal" };
  if (title || text !== first) data.summary = text;
  return data;
}

export function legacyText(ev: Envelope): string {
  if (ev.kind === "event" && ev.data.summary && ev.data.summary.startsWith(ev.data.title)) return ev.data.summary;
  return previewOfEnvelope(ev);
}

// 旧客户端只认 msg 帧: 任何事件压成一行文本, seq 与新模型连续
export function toMsgFrame(ev: Envelope): MsgFrame {
  const frame: MsgFrame = { t: "msg", seq: ev.seq, ts: ev.ts, src: ev.source.id, body: { kind: TEXT_MARK, text: legacyText(ev) } };
  if (ev.cid) frame.cid = ev.cid;
  return frame;
}

export function legacyBodyText(raw: string): string {
  try {
    const b = JSON.parse(raw) as { kind?: string; text?: unknown };
    return b.kind === TEXT_MARK && typeof b.text === "string" ? b.text : raw;
  } catch {
    return raw;
  }
}
