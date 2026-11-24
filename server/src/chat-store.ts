import type { ChatMeta, ChatPatch, Envelope, Favorite } from "@hx-aioa/protocol";

type MetaRow = { channel: string; body: string };
type FavRow = { seq: number; saved: number; body: string };
type AvatarRow = { mime: string; data: ArrayBuffer };

const MAX_FAVORITES = 2000;
const STUB_TEXT = 200;
// 收藏只存引用和一句摘要, 原消息没了时显示
type FavStub = { id: string; ts: number; src: string; text: string; channel?: string };

function stubText(ev: Envelope): string {
  const d = ev.data as { title?: string; summary?: string };
  return (d.summary || d.title || "").slice(0, STUB_TEXT);
}

function stubEnvelope(s: FavStub, seq: number): Envelope {
  const ev = { id: s.id, seq, ts: s.ts, kind: "event", source: { id: "", name: s.src }, priority: "happening", data: { title: s.text, severity: "normal" } };
  return (s.channel ? { ...ev, channel: s.channel } : ev) as Envelope;
}

// 群资料, 收藏 (存引用 + 一句摘要), 头像 (按内容哈希存, 永不变)
export class ChatStore {
  constructor(private readonly sql: SqlStorage) {
    sql.exec("CREATE TABLE IF NOT EXISTS chat_meta (channel TEXT PRIMARY KEY, body TEXT NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS fav (seq INTEGER PRIMARY KEY, saved INTEGER NOT NULL, body TEXT NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS avatar (id TEXT PRIMARY KEY, mime TEXT NOT NULL, data BLOB NOT NULL, created INTEGER NOT NULL)");
  }

  chats(): ChatMeta[] {
    return this.sql.exec<MetaRow>("SELECT channel, body FROM chat_meta").toArray().map((r) => JSON.parse(r.body) as ChatMeta);
  }

  chat(channel: string): ChatMeta | null {
    const r = this.sql.exec<MetaRow>("SELECT channel, body FROM chat_meta WHERE channel = ?", channel).toArray()[0];
    return r ? (JSON.parse(r.body) as ChatMeta) : null;
  }

  // 已读位置只前进, 多端同时上报时不会倒退
  patchChat(channel: string, patch: ChatPatch, now = Date.now()): ChatMeta {
    const cur = this.chat(channel) ?? { channel, updated: now };
    const next: ChatMeta = { ...cur, updated: now };
    for (const [k, v] of Object.entries(patch)) {
      if (k === "read" && typeof v === "number" && v <= (cur.read ?? 0)) continue;
      if (v === null || v === "" || v === false) delete (next as Record<string, unknown>)[k];
      else (next as Record<string, unknown>)[k] = v;
    }
    this.sql.exec("INSERT OR REPLACE INTO chat_meta (channel, body) VALUES (?, ?)", channel, JSON.stringify(next));
    return next;
  }

  replaceChat(meta: ChatMeta): void {
    this.sql.exec("INSERT OR REPLACE INTO chat_meta (channel, body) VALUES (?, ?)", meta.channel, JSON.stringify(meta));
  }

  /**
   * 收藏按引用: 每次读时按 id 取原消息的当前版本 (更新过的显示新内容, HTML / 附件原样);
   * 原消息被撤回, 删除或清空时 gone=true, 用收藏时留的小摘要兜底。旧数据存的是整条快照, 照样能当兜底。
   */
  favorites(resolve: (id: string, seq: number) => Envelope | null): Favorite[] {
    return this.sql
      .exec<FavRow>("SELECT seq, saved, body FROM fav ORDER BY saved DESC LIMIT ?", MAX_FAVORITES)
      .toArray()
      .map((r) => {
        const ref = JSON.parse(r.body) as Envelope | FavStub;
        const live = resolve(ref.id, r.seq);
        if (live && !live.deleted) return { seq: r.seq, saved: r.saved, ev: live };
        return { seq: r.seq, saved: r.saved, ev: "kind" in ref ? ref : stubEnvelope(ref, r.seq), gone: true };
      });
  }

  // 收藏的版本号: 条数, 最后修改时间, 以及消息库的头 (原消息变了也要让缓存失效)
  favoritesTag(head: number): string {
    const r = this.sql.exec<{ n: number; m: number | null }>("SELECT COUNT(*) AS n, MAX(saved) AS m FROM fav").one();
    return `${r.n}-${r.m ?? 0}-${head}`;
  }

  addFavorite(ev: Envelope, now = Date.now()): Favorite {
    const stub: FavStub = { id: ev.id, ts: ev.ts, src: ev.source.name || ev.source.id, text: stubText(ev), ...(ev.channel ? { channel: ev.channel } : {}) };
    this.sql.exec("INSERT OR REPLACE INTO fav (seq, saved, body) VALUES (?, ?, ?)", ev.seq, now, JSON.stringify(stub));
    return { seq: ev.seq, saved: now, ev };
  }

  removeFavorite(seq: number): boolean {
    return this.sql.exec("DELETE FROM fav WHERE seq = ?", seq).rowsWritten > 0;
  }

  putAvatar(id: string, mime: string, data: ArrayBuffer, now = Date.now()): void {
    this.sql.exec("INSERT OR IGNORE INTO avatar (id, mime, data, created) VALUES (?, ?, ?, ?)", id, mime, data, now);
  }

  avatar(id: string): AvatarRow | null {
    return this.sql.exec<AvatarRow>("SELECT mime, data FROM avatar WHERE id = ?", id).toArray()[0] ?? null;
  }
}
