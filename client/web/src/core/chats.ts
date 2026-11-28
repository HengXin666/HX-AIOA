import {
  PATH_CHAT,
  PATH_CHAT_MESSAGES,
  PATH_CHATS,
  PATH_EVENTS,
  QUERY_BEFORE,
  QUERY_KIND,
  QUERY_LIMIT,
  QUERY_SINCE,
  USER_SOURCE_PREFIX,
  type ChatMeta,
  type ChatPatch,
  type Envelope,
} from "@hx-aioa/protocol";
import { api, apiRaw, currentUser, fill } from "./auth";
import { cacheGet, cachePut } from "./cache";
import { CACHE_KEEP, CACHE_WRITE_DELAY_MS, DEVICE_PREFIX, MEMO_GROUP, PAGE_SIZE, READ_DELAY_MS, RECENT_SIZE } from "./constants";
import { Emitter } from "./emitter";
import { link, type Frame } from "./link";
import { Outbox } from "./outbox";

export type Message = Exclude<Envelope, { kind: "metric" }>;
// synced: 已和服务端最新一页对过; 之前显示的是本地缓存
export type Thread = { items: Message[]; loaded: boolean; more: boolean; synced: boolean };
type Snapshot = { chats: ChatMeta[]; last: Record<string, Message | undefined>; version: number };
type CachedList = { chats: ChatMeta[]; etag: string | null; last: Record<string, Message | undefined> };

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

export const titleOf = (c: ChatMeta): string => c.title || c.channel;
// 撤回的消息换了新 seq, 仍按原位置排
const posOf = (m: Message): number => m.deleted?.seq ?? m.seq;
export const mentionsMe = (m: Message): boolean => {
  const me = currentUser()?.id;
  return Boolean(m.mentions?.some((x) => x === "all" || x === me));
};

class ChatStore {
  readonly changed = new Emitter<void>();
  readonly outbox = new Outbox(() => this.bump());
  private snap: Snapshot = { chats: [], last: {}, version: 0 };
  private threads = new Map<string, Thread>();
  private etag: string | null = null;
  private head = 0;
  private ready: Promise<void> = Promise.resolve();
  private uid = "";
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  snapshot = (): Snapshot => this.snap;
  thread = (channel: string): Thread | undefined => this.threads.get(channel);
  meta = (channel: string): ChatMeta | undefined => this.snap.chats.find((c) => c.channel === channel);

  attach(): () => void {
    this.uid = currentUser()?.id ?? "";
    this.ready = this.restore();
    const off = link.frames.on((f) => this.onFrame(f));
    return () => {
      off();
      this.reset();
    };
  }

  // 置顶在前, 其余按最后一条消息 (没有就按群资料更新时间) 倒序
  ordered(): ChatMeta[] {
    const at = (c: ChatMeta) => this.snap.last[c.channel]?.ts ?? c.updated;
    return [...this.snap.chats].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || at(b) - at(a));
  }

  // 已知的最新事件位置 (welcome 与新事件推进), 总览按它往前取一段历史
  latest(): number {
    return this.head;
  }

  // 未读条数: 本地有的消息里数; 数不出来 (没缓存) 但有新消息时返回 -1 只显示圆点
  unread(c: ChatMeta): number {
    const read = c.read ?? 0;
    const t = this.threads.get(c.channel);
    const me = currentUser()?.id;
    if (t?.items.length) return t.items.filter((m) => m.seq > read && !m.deleted && m.by !== me).length;
    const last = this.snap.last[c.channel];
    return last && last.seq > read && last.by !== me ? -1 : 0;
  }

  // 会话列表带 ETag, 没变时 304 不读全表; 只在连上与收到 chat_sync 时拉
  async loadChats(): Promise<void> {
    await this.ready;
    const r = await apiRaw<{ chats: ChatMeta[] }>(PATH_CHATS, { headers: this.etag ? { "if-none-match": this.etag } : {} });
    if (r.status === 304 || !r.data) return;
    this.etag = r.etag;
    this.publish(r.data.chats.filter((c) => !c.deleted));
  }

  async loadThread(channel: string): Promise<void> {
    await this.ready;
    const t = this.threads.get(channel);
    if (t?.synced && !t.more) return;
    const older = Boolean(t?.synced && t.items.length);
    const before = older ? posOf(t!.items[0]!) : Number.MAX_SAFE_INTEGER;
    const url = `${fill(PATH_CHAT_MESSAGES, channel)}?${QUERY_BEFORE}=${before}&${QUERY_LIMIT}=${PAGE_SIZE}`;
    const r = await apiRaw<{ messages: Envelope[]; head: number }>(url);
    const got = (r.data?.messages ?? []).filter((m): m is Message => m.kind !== "metric" && m.deleted?.mode !== "delete");
    const full = got.length >= PAGE_SIZE;
    const have = this.threads.get(channel)?.items ?? [];
    let keep = have;
    if (!older && got.length) {
      // 最新一页满了, 和缓存之间可能有缺口, 只留这页之后的; 不满说明这就是全部
      const first = got[0]!.seq;
      const lastSeq = got[got.length - 1]!.seq;
      keep = full ? have.filter((m) => m.seq >= first) : have.filter((m) => m.seq > lastSeq);
    }
    this.threads.set(channel, { items: mergeSeq(got, keep), loaded: true, more: full, synced: true });
    this.saveThread(channel);
    this.bump();
  }

  async patch(channel: string, p: ChatPatch): Promise<void> {
    const r = await api<{ chat: ChatMeta }>(fill(PATH_CHAT, channel), { method: "PATCH", body: JSON.stringify(p) });
    if (r?.chat) this.upsert(r.chat);
  }

  // 打开会话与看到新消息时上报已读, 合并一小段时间内的多次; 只前进
  markRead(channel: string): void {
    const c = this.meta(channel);
    const t = this.threads.get(channel);
    const top = Math.max(t?.items[t.items.length - 1]?.seq ?? 0, this.snap.last[channel]?.seq ?? 0);
    if (!c || top <= (c.read ?? 0)) return;
    this.upsert({ ...c, read: top }, false);
    const key = `read:${channel}`;
    clearTimeout(this.timers.get(key));
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        void api(fill(PATH_CHAT, channel), { method: "PATCH", body: JSON.stringify({ read: top }) }).catch(() => undefined);
      }, READ_DELAY_MS),
    );
  }

  send(channel: string, text: string, extra: { reply?: Message; mentions?: string[] } = {}): void {
    this.outbox.send(channel, text, extra);
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
    this.saveList();
    this.changed.emit();
  }

  private onFrame(f: Frame): void {
    switch (f.t) {
      case "welcome": {
        const first = this.head === 0;
        this.head = Number(f.head) || 0;
        if (f.resync) this.dropThreads();
        void this.loadChats().catch(() => undefined);
        if (first) void this.loadRecent().catch(() => undefined);
        return;
      }
      case "ev":
        return this.onEvent(f.ev as Envelope);
      case "sent":
        return this.outbox.sent(String(f.cid));
      case "chat_sync":
        if (f.topic !== "chats") return;
        if (f.chat) return this.upsert(f.chat as ChatMeta);
        return void this.loadChats().catch(() => undefined);
      case "chat_read": {
        const c = this.meta(String(f.channel));
        if (c && Number(f.read) > (c.read ?? 0)) this.upsert({ ...c, read: Number(f.read) }, false);
        return;
      }
    }
  }

  private onEvent(ev: Envelope): void {
    if (ev.seq > this.head) this.head = ev.seq;
    const g = groupOf(ev);
    if (!g || ev.kind === "metric") return;
    if (ev.cid) this.outbox.arrived(ev.cid);
    const t = this.threads.get(g);
    if (t) {
      const rest = t.items.filter((m) => m.id !== ev.id);
      this.threads.set(g, { ...t, items: ev.deleted?.mode === "delete" ? rest : mergeSeq([ev], rest) });
      this.saveThread(g);
    }
    const last = { ...this.snap.last, [g]: ev.deleted ? this.snap.last[g] : ev };
    const known = this.snap.chats.some((c) => c.channel === g);
    this.snap = { ...this.snap, last, version: this.snap.version + 1 };
    this.saveList();
    if (!known) void this.loadChats().catch(() => undefined);
    this.changed.emit();
  }

  private upsert(chat: ChatMeta, save = true): void {
    if (chat.deleted) {
      this.threads.delete(chat.channel);
      return this.publish(this.snap.chats.filter((c) => c.channel !== chat.channel), save);
    }
    const t = this.threads.get(chat.channel);
    if (t && chat.cleared) {
      this.threads.set(chat.channel, { ...t, items: t.items.filter((m) => m.seq > (chat.cleared ?? 0)) });
      this.saveThread(chat.channel);
    }
    const has = this.snap.chats.some((c) => c.channel === chat.channel);
    const chats = has ? this.snap.chats.map((c) => (c.channel === chat.channel ? chat : c)) : [...this.snap.chats, chat];
    this.publish(chats, save);
  }

  private publish(chats: ChatMeta[], save = true): void {
    this.snap = { ...this.snap, chats, version: this.snap.version + 1 };
    if (save) this.saveList();
    this.changed.emit();
  }

  private bump(): void {
    this.snap = { ...this.snap, version: this.snap.version + 1 };
    this.changed.emit();
  }

  private key = (k: string) => `u:${this.uid}:${k}`;

  // 先把上次的列表与每个群最近的消息读出来, 首屏不等网络
  private async restore(): Promise<void> {
    if (!this.uid) return;
    const list = await cacheGet<CachedList>(this.key("chats"));
    if (!list) return;
    this.etag = list.etag;
    const last = { ...list.last };
    await Promise.all(
      list.chats.map(async (c) => {
        const items = await cacheGet<Message[]>(this.key(`t:${c.channel}`));
        if (!items?.length || this.threads.has(c.channel)) return;
        this.threads.set(c.channel, { items, loaded: false, more: true, synced: false });
        const end = items[items.length - 1]!;
        if (!last[c.channel] || last[c.channel]!.seq < end.seq) last[c.channel] = end;
      }),
    );
    if (this.snap.chats.length) return;
    this.snap = { chats: list.chats, last, version: this.snap.version + 1 };
    this.changed.emit();
  }

  private later(k: string, fn: () => void): void {
    if (this.timers.has(k)) return;
    this.timers.set(
      k,
      setTimeout(() => {
        this.timers.delete(k);
        fn();
      }, CACHE_WRITE_DELAY_MS),
    );
  }

  private saveList(): void {
    if (!this.uid) return;
    this.later("list", () => void cachePut(this.key("chats"), { chats: this.snap.chats, etag: this.etag, last: this.snap.last } satisfies CachedList));
  }

  private saveThread(channel: string): void {
    if (!this.uid) return;
    this.later(`t:${channel}`, () => {
      const t = this.threads.get(channel);
      if (t) void cachePut(this.key(`t:${channel}`), t.items.slice(-CACHE_KEEP));
    });
  }

  private dropThreads(): void {
    for (const ch of this.threads.keys()) void cachePut(this.key(`t:${ch}`), []);
    this.threads.clear();
  }

  private reset(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.threads.clear();
    this.outbox.clear();
    this.snap = { chats: [], last: {}, version: this.snap.version + 1 };
    this.etag = null;
    this.head = 0;
    this.uid = "";
  }
}

function mergeSeq(a: Message[], b: Message[]): Message[] {
  const byId = new Map<string, Message>();
  for (const m of [...b, ...a]) byId.set(m.id, m);
  return [...byId.values()].sort((x, y) => posOf(x) - posOf(y));
}

export const chats = new ChatStore();
