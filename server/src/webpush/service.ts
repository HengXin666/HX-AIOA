import type { Envelope, WebPushPayload } from "@hx-aioa/protocol";
import { PUSH_TITLE } from "../constants";
import type { Env } from "../env";
import { titleOf } from "../group";
import { groupOf } from "../store";
import { b64url, encryptPayload, VapidSigner } from "./crypto";
import type { WebPushRow, WebPushStore } from "./store";

export const WEBPUSH_TTL_SEC = 86_400;
export const WEBPUSH_TITLE_MAX = 64;
export const WEBPUSH_BODY_MAX = 140;
const TOPIC_LEN = 32;
const GONE = [404, 410];
const enc = new TextEncoder();

export type WebPushResult = { sent: number; dropped: number; skipped: number; failed: number };

const clip = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** 通知明文: 标题用发送者, 正文是纯文本摘要, 多条时带条数。 */
export function payloadOf(last: Envelope, count: number): WebPushPayload {
  const channel = groupOf(last) ?? undefined;
  const text = titleOf(last);
  const body = count > 1 ? `${count} 条新消息: ${text}` : text;
  const p: WebPushPayload = { title: clip(last.source.name || PUSH_TITLE, WEBPUSH_TITLE_MAX), body: clip(body, WEBPUSH_BODY_MAX), seq: last.seq, tag: channel ?? PUSH_TITLE };
  if (channel) p.channel = channel;
  return p;
}

// Topic 只允许 32 个 base64url 字符: 用 tag 的哈希, 同一个群还没送达的旧通知会被新的替换
async function topicOf(tag: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(tag)))).slice(0, TOPIC_LEN);
}

/** Web Push 渠道: VAPID 三项都配了才可用; 只发给没开着页面的 Web 设备。 */
export class WebPush {
  private signer: VapidSigner | null = null;

  constructor(
    private readonly env: Env,
    readonly store: WebPushStore,
    // 该设备有前台长连接: 页面开着, 由页面自己提醒
    private readonly online: (device: string) => boolean,
    private readonly ownerId: () => string,
  ) {}

  static configured(env: Env): boolean {
    return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
  }

  publicKey(): string | null {
    return WebPush.configured(this.env) ? (this.env.VAPID_PUBLIC_KEY ?? null) : null;
  }

  /** 配置齐全且主人至少有一个订阅: 只有这时才值得为它等 ACK 超时。 */
  ready(): boolean {
    return WebPush.configured(this.env) && this.store.count(this.ownerId()) > 0;
  }

  async send(last: Envelope, count: number, urgent: boolean): Promise<WebPushResult> {
    const r: WebPushResult = { sent: 0, dropped: 0, skipped: 0, failed: 0 };
    if (!WebPush.configured(this.env)) return r;
    this.signer ??= new VapidSigner(this.env.VAPID_PUBLIC_KEY!, this.env.VAPID_PRIVATE_KEY!, this.env.VAPID_SUBJECT!);
    const payload = payloadOf(last, count);
    const plain = enc.encode(JSON.stringify(payload));
    const topic = await topicOf(payload.tag);
    const rows = this.store.list(this.ownerId()).filter((row) => {
      if (!this.online(row.device)) return true;
      r.skipped += 1;
      return false;
    });
    const results = await Promise.allSettled(rows.map((row) => this.one(row, plain, urgent, topic)));
    results.forEach((res, i) => {
      if (res.status === "fulfilled" && res.value === "sent") r.sent += 1;
      else if (res.status === "fulfilled") {
        r.dropped += 1;
        this.store.dropEndpoint(rows[i]!.endpoint);
      } else {
        r.failed += 1;
        console.error("Web Push 失败:", rows[i]?.device, res.reason);
      }
    });
    return r;
  }

  private async one(row: WebPushRow, plain: Uint8Array, urgent: boolean, topic: string): Promise<"sent" | "gone"> {
    const body = await encryptPayload(plain, row.p256dh, row.auth);
    const res = await fetch(row.endpoint, {
      method: "POST",
      headers: {
        Authorization: await this.signer!.header(row.endpoint),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(WEBPUSH_TTL_SEC),
        Urgency: urgent ? "high" : "normal",
        Topic: topic,
      },
      body,
    });
    await res.body?.cancel();
    if (GONE.includes(res.status)) return "gone";
    if (!res.ok) throw new Error(`状态码 ${res.status}`);
    return "sent";
  }
}
