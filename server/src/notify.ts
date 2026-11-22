import type { DeliveryChannel } from "@hx-aioa/protocol";
import { MIPUSH_ENDPOINT, PUSH_TITLE, WXPUSHER_ENDPOINT } from "./constants";
import type { Env } from "./env";

export type FallbackJob = {
  preview: string;
  count: number;
  pushToken: string | undefined;
  channels: Set<DeliveryChannel>;
  wxUid: string | undefined;
};

export function hasFallback(env: Env): boolean {
  return Boolean(env.MIPUSH_APP_SECRET || env.WXPUSHER_APP_TOKEN);
}

export async function sendFallback(env: Env, job: FallbackJob): Promise<void> {
  const text = job.count > 1 ? `${job.count} 条新消息: ${job.preview}` : job.preview;
  const tasks: Promise<void>[] = [];
  if (job.channels.has("mipush") && env.MIPUSH_APP_SECRET && env.MIPUSH_PACKAGE && job.pushToken) {
    tasks.push(miPush(env.MIPUSH_APP_SECRET, env.MIPUSH_PACKAGE, job.pushToken, text));
  }
  const uid = job.wxUid || env.WXPUSHER_UID;
  if (job.channels.has("wxpusher") && env.WXPUSHER_APP_TOKEN && uid) {
    tasks.push(wxPusher(env.WXPUSHER_APP_TOKEN, uid, text));
  }
  const results = await Promise.allSettled(tasks);
  for (const r of results) {
    if (r.status === "rejected") console.error("兜底推送失败:", r.reason);
  }
}

// 参数以小米推送服务端 API 文档为准, 首次接入时需要核对
async function miPush(secret: string, pkg: string, regId: string, text: string): Promise<void> {
  const form = new URLSearchParams({
    registration_id: regId,
    restricted_package_name: pkg,
    title: PUSH_TITLE,
    description: text,
    payload: text,
    pass_through: "0",
    notify_type: "-1",
  });
  const res = await fetch(MIPUSH_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `key=${secret}` },
    body: form,
  });
  if (!res.ok) throw new Error(`MiPush 状态码 ${res.status}`);
}

async function wxPusher(appToken: string, uid: string, text: string): Promise<void> {
  const res = await fetch(WXPUSHER_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appToken, content: text, summary: text, contentType: 1, uids: [uid] }),
  });
  if (!res.ok) throw new Error(`WxPusher 状态码 ${res.status}`);
}
