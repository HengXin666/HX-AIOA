import { FEED_STATUSES, type FeedStatus, type FeedTag } from "@hx-aioa/protocol";
import { textOf, type Message } from "./chats";
import { Emitter } from "./emitter";

export const TAG_OTHER = "other";
// 统一推送卡片的一条 (对照安卓 feed/FeedModel.kt); key 用于去重和本机标记
export type FeedEntry = {
  key: string;
  title: string;
  url?: string;
  site?: string;
  kind: string;
  status?: FeedStatus;
  summary?: string;
  todo?: string;
  until?: string;
  heat?: number;
  likes?: number;
  replies?: number;
  links: { label: string; url: string }[];
  source: string;
  // 显示用时间: 原帖发布时间, 没有用消息时间
  time: number;
  ts: number;
  seq: number;
};

const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : undefined);
const atOf = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" ? Date.parse(v) || 0 : 0);

// 一条消息的 data.feed; 没有 feed 的旧格式消息整条当一项, 样式统一
function entriesOf(m: Message): FeedEntry[] {
  const d = m.kind === "event" ? m.data : null;
  const feed = d?.feed;
  if (!feed) {
    const [title = "", ...rest] = textOf(m).split("\n");
    if (!title.trim()) return [];
    return [{ key: `m:${m.id}`, title, url: d?.url, kind: TAG_OTHER, summary: rest.join("\n").trim() || undefined, links: [], source: m.source.name, time: m.ts, ts: m.ts, seq: m.seq }];
  }
  const source = feed.source || m.source.name;
  return feed.items.flatMap((o) => {
    if (!o.title?.trim()) return [];
    const at = atOf(o.at);
    return [
      {
        key: o.id || o.url || `${source}:${o.title}`,
        title: o.title,
        url: o.url,
        site: o.site,
        kind: o.kind || TAG_OTHER,
        status: o.status && (FEED_STATUSES as readonly string[]).includes(o.status) ? o.status : undefined,
        summary: o.summary,
        todo: o.todo,
        until: o.until,
        heat: count(o.heat),
        likes: count(o.likes),
        replies: count(o.replies),
        links: o.links ?? [],
        source,
        time: at > 0 ? at : m.ts,
        ts: m.ts,
        seq: m.seq,
      },
    ];
  });
}

// 群里所有条目, 新的在前; 同 key 只留最新一次推送
export function feedEntries(messages: Message[]): FeedEntry[] {
  const seen = new Set<string>();
  return [...messages]
    .filter((m) => !m.deleted)
    .sort((a, b) => b.seq - a.seq)
    .flatMap(entriesOf)
    .filter((e) => !seen.has(e.key) && Boolean(seen.add(e.key)));
}

export const labelOf = (tags: FeedTag[], id: string) => tags.find((t) => t.id === id)?.label ?? id;

// 本机标记: 用过, 我标的失效, 收藏 (与安卓一样只存本机)
export const MARK_USED = "used";
export const MARK_DEAD = "dead";
export const MARK_STAR = "star";
type Mark = typeof MARK_USED | typeof MARK_DEAD | typeof MARK_STAR;
const MARKS_KEY = "aioa.feed.marks";
const MAX_KEYS = 1000;

class FeedMarks {
  readonly changed = new Emitter<void>();
  private sets: Record<Mark, string[]>;
  version = 0;

  constructor() {
    let saved: Partial<Record<Mark, string[]>> = {};
    try {
      saved = JSON.parse(localStorage.getItem(MARKS_KEY) ?? "{}") as typeof saved;
    } catch {
      saved = {};
    }
    this.sets = { used: saved.used ?? [], dead: saved.dead ?? [], star: saved.star ?? [] };
  }

  has = (m: Mark, key: string) => this.sets[m].includes(key);

  toggle(m: Mark, key: string): void {
    const s = this.sets[m];
    this.sets[m] = (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]).slice(-MAX_KEYS);
    localStorage.setItem(MARKS_KEY, JSON.stringify(this.sets));
    this.version++;
    this.changed.emit();
  }

  // 实际状态: 我标了失效就是失效, 否则用推送方给的
  status = (e: FeedEntry): FeedStatus | undefined => (this.has(MARK_DEAD, e.key) ? "dead" : e.status);
}

export const feedMarks = new FeedMarks();
