import { BUNDLE_HEAD, BUNDLE_HEAD_TEXT, BUNDLE_TEXT_PREFIX, MAX_ID_LENGTH, type BundleInfo, type BundleRequest, type Envelope, type EventInput, type MsgRef, type SendFrame } from "@hx-aioa/protocol";
import { messageInput } from "./api-events";
import { legacyText } from "./legacy";
import type { EventStore } from "./store";

const EXCERPT = 200;
// 发送者看不到的消息不能被引用, 转发或合并
export type CanSee = (ev: Envelope) => boolean;

// 引用快照: 只存摘要, 原消息被清理后引用仍能显示
export function refOf(ev: Envelope): MsgRef {
  return { seq: ev.seq, id: ev.id, src: ev.source.name || ev.source.id, text: legacyText(ev).slice(0, EXCERPT) };
}

/** 合并转发卡片 (#132): 撤回 / 删除 / 看不到的原消息不算; 一条都没有时返回错误文字。 */
export function bundleOf(store: EventStore, b: BundleRequest, canSee: CanSee): BundleInfo | string {
  const evs = store.bySeqs(b.seqs).filter((ev) => !ev.deleted && canSee(ev));
  if (!evs.length) return "合并转发的消息都不存在";
  const head = evs.slice(0, BUNDLE_HEAD).map((ev) => ({ src: ev.source.name || ev.source.id, text: legacyText(ev).slice(0, BUNDLE_HEAD_TEXT) }));
  return { from: b.from, count: evs.length, refs: evs.map((ev) => ev.seq), head };
}

// 聊天发送: 正文, 目标群, 引用, 转发 (转发时正文取原消息全文), @ 与合并转发
export function chatInput(store: EventStore, f: SendFrame, canSee: CanSee = () => true): EventInput | string {
  let text = f.body.text;
  let fwd: EventInput["fwd"];
  const orig = f.fwd ? store.bySeq(f.fwd) : null;
  if (f.fwd) {
    if (!orig || !canSee(orig)) return "被转发的消息不存在";
    text = legacyText(orig);
    fwd = { src: orig.source.name || orig.source.id, ts: orig.ts, ...(orig.channel ? { channel: orig.channel } : {}) };
  }
  const bundle = f.bundle ? bundleOf(store, f.bundle, canSee) : undefined;
  if (typeof bundle === "string") return bundle;
  if (bundle) text = `${BUNDLE_TEXT_PREFIX} ${bundle.from}`;
  const input = messageInput({ text });
  if (typeof input === "string") return input;
  if (f.channel) {
    if (f.channel.length > MAX_ID_LENGTH) return "群名过长";
    input.channel = f.channel;
  }
  if (fwd) input.fwd = fwd;
  if (f.mentions) input.mentions = f.mentions;
  if (input.kind === "event") {
    // 转发带上原消息的附件 (同一个文件, 引用数 +1)
    if (orig?.kind === "event" && orig.data.file) input.data = { ...input.data, file: orig.data.file };
    if (bundle) input.data = { ...input.data, bundle };
  }
  if (f.reply) {
    const r = store.bySeq(f.reply);
    if (r && canSee(r)) input.reply = refOf(r);
  }
  return input;
}
