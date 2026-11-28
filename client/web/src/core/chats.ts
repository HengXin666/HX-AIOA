import {
  PATH_CHAT_MESSAGES,
  PATH_CHATS,
  PATH_EVENTS,
  QUERY_BEFORE,
  QUERY_KIND,
  QUERY_LIMIT,
  QUERY_SINCE,
  USER_SOURCE_PREFIX,
  type ChatMeta,
  type Envelope,
} from "@hx-aioa/protocol";
import { apiRaw, currentUser, fill } from "./auth";
import { DEVICE_PREFIX, MEMO_GROUP, PAGE_SIZE, RECENT_SIZE } from "./constants";
import { Emitter } from "./emitter";
import { link, type Frame } from "./link";

export type Message = Exclude<Envelope, { kind: "metric" }>;
export type Thread = { items: Message[]; loaded: boolean; more: boolean };
type Snapshot = { chats: ChatMeta[]; last: Record<string, Message | undefined>; version: number };

// 与服务端 store.groupOf 同一规则: 没写 channel 的按来源名, 本机或本人发出的归备忘
export function groupOf(ev: Envelope): string | null {
  if (ev.kind === "metric") return null;
  if (ev.channel) return ev.channel;
  const id = ev.source.id;
  if (id.startsWith("android") || id.startsWith(DEVICE_PREFIX) || id.startsWith(USER_SOURCE_PREFIX)) return MEMO_GROUP;
  return ev.source.name || ev.source.id;
}

export const textOf = (m: Message): string => {
  const d = m.data as { title?: string; summary?: string };
  return d.summary ? `${d.title ?? ""}\n${d.summary}`.trim() : (d.title ?? "");
};

class ChatStore {
  readonly changed = new Emitter<void>();
  private snap: Snapshot = { chats: [], last: {}, version: 0 };
  private threads = new Map<string, Thread>();
  private etag: string | null = null;
  private head = 0;

  snapshot = (): Snapshot => this.snap;
  thread = (channel: string): Thread | undefined => this.threads.get(channel);

  attach(): () => void {
    return link.frames.on((f) => this.onFrame(f));
  }

  // 会话列表带 ETag, 没变时 304 不读全表; 只在连上与收到 chat_sync 时拉
  async loadChats(): Promise<void> {
    const r = await apiRaw<{ chats: ChatMeta[] }>(PATH_CHATS, { headers: this.etag ? { "if-none-match": this.etag } : {} });
    if (r.status === 304 || !r.data) return;
    this.etag = r.etag;
    this.publish(r.data.chats.filter((c) => !c.deleted));
  }

  async loadThread(channel: string): Promise<void> {
    const t = this.threads.get(channel);
    const before = t?.items[0]?.seq ?? this.head + 1;
    if (t?.loaded && !t.more) return;
    const url = `${fill(PATH_CHAT_MESSAGES, channel)}?${QUERY_BEFORE}=${before || Number.MAX_SAFE_INTEGER}&${QUERY_LIMIT}=${PAGE_SIZE}`;
    const r = await apiRaw<{ messages: Envelope[]; head: number }>(url);
    const got = (r.data?.messages ?? []).filter((m): m is Message => m.kind !== "metric");
    const merged = mergeSeq(got, t?.items ?? []);
    this.threads.set(channel, { items: merged, loaded: true, more: got.length >= PAGE_SIZE });
    this.bump();
  }

  // 首次连上拉最近一批事件, 给列表补每个会话的最后一条; 只有主人能读全量事件
  private async loadRecent(): Promise<void> {
    if (currentUser()?.role !== "owner" || this.head === 0) return;
    const since = Math.max(0, this.head - RECENT_SIZE);
    const r = await apiRaw<{ events: Envelope[] }>(`${PATH_EVENTS}?${QUERY_SINCE}=${since}&${QUERY_LIMIT}=${RECENT_SIZE}&${QUERY_KIND}=event`);
    const last = { ...this.snap.last };
    for (const ev of r.data?.events ?? []) {
      const g = groupOf(ev);
      if (g && ev.kind !== "metric" && !ev.deleted && (last[g]?.seq ?? 0) < ev.seq) last[g] = ev;
    }
    this.snap = { ...this.snap, last, version: this.snap.version + 1 };
    this.changed.emit();
  }

  private onFrame(f: Frame): void {
    switch (f.t) {
      case "welcome": {
        const first = this.head === 0;
        this.head = Number(f.head) || 0;
        link.seen(this.head);
        void this.loadChats();
        if (first) void this.loadRecent();
        return;
      }
      case "ev":
        return this.onEvent(f.ev as Envelope);
      case "chat_sync":
        if (f.topic === "chats") void this.loadChats();
        return;
      case "chat_read": {
        const chats = this.snap.chats.map((c) => (c.channel === f.channel ? { ...c, read: Number(f.read) } : c));
        return this.publish(chats);
      }
    }
  }

  private onEvent(ev: Envelope): void {
    link.seen(ev.seq);
    if (ev.seq > this.head) this.head = ev.seq;
    const g = groupOf(ev);
    if (!g || ev.kind === "metric") return;
    const t = this.threads.get(g);
    if (t) this.threads.set(g, { ...t, items: mergeSeq([ev], t.items.filter((m) => m.id !== ev.id)) });
    const last = { ...this.snap.last, [g]: ev.deleted ? this.snap.last[g] : ev };
    const known = this.snap.chats.some((c) => c.channel === g);
    this.snap = { ...this.snap, last, version: this.snap.version + 1 };
    if (!known) void this.loadChats();
    this.changed.emit();
  }

  private publish(chats: ChatMeta[]): void {
    this.snap = { ...this.snap, chats, version: this.snap.version + 1 };
    this.changed.emit();
  }

  private bump(): void {
    this.snap = { ...this.snap, version: this.snap.version + 1 };
    this.changed.emit();
  }
}

function mergeSeq(a: Message[], b: Message[]): Message[] {
  const byId = new Map<string, Message>();
  for (const m of [...b, ...a]) byId.set(m.id, m);
  return [...byId.values()].sort((x, y) => x.seq - y.seq);
}

export const chats = new ChatStore();
