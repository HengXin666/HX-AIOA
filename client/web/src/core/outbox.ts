import type { Envelope } from "@hx-aioa/protocol";
import { MEMO_GROUP, SEND_TIMEOUT_MS } from "./constants";
import { link } from "./link";

type Msg = Exclude<Envelope, { kind: "metric" }>;
// 还没确认的发送: 连不上或超时没回 sent 就标失败, 用户点重试再发一次 (新 cid)
export type Pending = { cid: string; channel: string; text: string; reply?: Msg; mentions?: string[]; at: number; failed: boolean };
const SETTLE_MS = 1_500;

export class Outbox {
  private items: Pending[] = [];
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly changed: () => void) {}

  of(channel: string): Pending[] {
    return this.items.filter((p) => p.channel === channel);
  }

  send(channel: string, text: string, extra: { reply?: Msg; mentions?: string[] }): void {
    const cid =
      link.send({
        body: { kind: "text", text },
        channel: channel === MEMO_GROUP ? undefined : channel,
        ...(extra.reply ? { reply: extra.reply.seq } : {}),
        ...(extra.mentions?.length ? { mentions: extra.mentions } : {}),
      }) ?? `x${Date.now().toString(36)}`;
    const failed = cid.startsWith("x");
    this.items = [...this.items, { cid, channel, text, ...extra, at: Date.now(), failed }];
    if (!failed) this.arm(cid, SEND_TIMEOUT_MS, () => this.fail(cid));
    this.changed();
  }

  retry(cid: string): void {
    const p = this.items.find((x) => x.cid === cid);
    if (!p) return;
    this.drop(cid);
    this.send(p.channel, p.text, { reply: p.reply, mentions: p.mentions });
  }

  discard(cid: string): void {
    this.drop(cid);
    this.changed();
  }

  // sent 与对应的 ev 先后不定: 收到 ev 立即移除, 只收到 sent 时稍等再移除, 避免列表闪一下
  sent(cid: string): void {
    if (!this.items.some((p) => p.cid === cid)) return;
    this.arm(cid, SETTLE_MS, () => this.discard(cid));
  }

  arrived(cid: string): void {
    if (this.items.some((p) => p.cid === cid)) this.discard(cid);
  }

  clear(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.items = [];
  }

  private fail(cid: string): void {
    this.items = this.items.map((p) => (p.cid === cid ? { ...p, failed: true } : p));
    this.changed();
  }

  private drop(cid: string): void {
    clearTimeout(this.timers.get(cid));
    this.timers.delete(cid);
    this.items = this.items.filter((p) => p.cid !== cid);
  }

  private arm(cid: string, ms: number, fn: () => void): void {
    clearTimeout(this.timers.get(cid));
    this.timers.set(cid, setTimeout(() => (this.timers.delete(cid), fn()), ms));
  }
}
