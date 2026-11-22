import { MAX_ID_LENGTH, type Envelope, type EventInput, type MsgRef, type SendFrame } from "@hx-aioa/protocol";
import { messageInput } from "./api-events";
import { legacyText } from "./legacy";
import type { EventStore } from "./store";

const EXCERPT = 200;

// 引用快照: 只存摘要, 原消息被清理后引用仍能显示
export function refOf(ev: Envelope): MsgRef {
  return { seq: ev.seq, id: ev.id, src: ev.source.name || ev.source.id, text: legacyText(ev).slice(0, EXCERPT) };
}

// 聊天发送: 正文, 目标群, 引用, 转发 (转发时正文取原消息全文)
export function chatInput(store: EventStore, f: SendFrame): EventInput | string {
  let text = f.body.text;
  let fwd: EventInput["fwd"];
  if (f.fwd) {
    const orig = store.bySeq(f.fwd);
    if (!orig) return "被转发的消息不存在";
    text = legacyText(orig);
    fwd = { src: orig.source.name || orig.source.id, ts: orig.ts, ...(orig.channel ? { channel: orig.channel } : {}) };
  }
  const input = messageInput({ text });
  if (typeof input === "string") return input;
  if (f.channel) {
    if (f.channel.length > MAX_ID_LENGTH) return "群名过长";
    input.channel = f.channel;
  }
  if (fwd) input.fwd = fwd;
  if (f.reply) {
    const r = store.bySeq(f.reply);
    if (r) input.reply = refOf(r);
  }
  return input;
}
