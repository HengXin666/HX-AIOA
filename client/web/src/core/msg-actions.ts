import { BUNDLE_TEXT_PREFIX, MAX_BUNDLE, PATH_EVENTS_BY_SEQS, PATH_FAVORITE, PATH_FAVORITES, QUERY_SEQS, QUERY_VIA, type Envelope, type EventsBySeqs, type Favorite } from "@hx-aioa/protocol";
import { api, fill } from "./auth";
import { textOf, type Message } from "./chats";
import { MEMO_GROUP } from "./constants";
import { link } from "./link";

const target = (channel: string) => (channel === MEMO_GROUP ? undefined : channel);

// 逐条转发: 每条一条新消息, 带原消息 seq, 服务端补 "转发自" (对照安卓 ChatGroups.forward)
export function forward(items: Message[], channel: string): boolean {
  let ok = true;
  for (const m of [...items].sort((a, b) => a.seq - b.seq)) {
    ok = link.send({ body: { kind: "text", text: textOf(m) }, channel: target(channel), fwd: m.seq }) !== null && ok;
  }
  return ok;
}

// 合并转发 (#132): 一条消息只带引用, 卡片由服务端生成
export function forwardBundle(items: Message[], from: string, channel: string): boolean {
  const seqs = items.map((m) => m.seq).sort((a, b) => a - b).slice(0, MAX_BUNDLE);
  return link.send({ body: { kind: "text", text: `${BUNDLE_TEXT_PREFIX} ${from}` }, channel: target(channel), bundle: { from, seqs } }) !== null;
}

export async function favorite(seq: number): Promise<void> {
  await api(fill(PATH_FAVORITE, String(seq)), { method: "PUT" });
}

export async function unfavorite(seq: number): Promise<void> {
  await api(fill(PATH_FAVORITE, String(seq)), { method: "DELETE" });
}

export async function favorites(): Promise<Favorite[]> {
  const r = await api<{ favorites: Favorite[] }>(PATH_FAVORITES);
  return r?.favorites ?? [];
}

// 合并转发详情: 按卡片里的 refs 批量取, via 为卡片 seq (能读卡片就能读里面的消息)
export async function bundleItems(refs: number[], via: number[]): Promise<Envelope[]> {
  const r = await api<EventsBySeqs>(`${PATH_EVENTS_BY_SEQS}?${QUERY_SEQS}=${refs.join(",")}&${QUERY_VIA}=${via.join(",")}`);
  return r?.events ?? [];
}
