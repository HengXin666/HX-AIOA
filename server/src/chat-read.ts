type ReadRow = { channel: string; read: number };

/**
 * 已读位置 (#129): 每人每群一行, 只前进; 不改群资料, 也不触发 chat_sync。
 * 主人与子号都存这里; 旧数据 (主人在 chat_meta.read, 子号在 room_member.prefs) 读取时取较大者。
 */
export class ChatReads {
  constructor(private readonly sql: SqlStorage) {
    sql.exec("CREATE TABLE IF NOT EXISTS chat_read (uid TEXT NOT NULL, channel TEXT NOT NULL, read INTEGER NOT NULL, PRIMARY KEY (uid, channel)) WITHOUT ROWID");
  }

  /** 前进成功返回 true; 不比原来大时不写。 */
  mark(uid: string, channel: string, read: number): boolean {
    return this.sql.exec("INSERT INTO chat_read (uid, channel, read) VALUES (?, ?, ?) ON CONFLICT (uid, channel) DO UPDATE SET read = excluded.read WHERE excluded.read > chat_read.read", uid, channel, read).rowsWritten > 0;
  }

  get(uid: string, channel: string): number {
    return this.sql.exec<ReadRow>("SELECT channel, read FROM chat_read WHERE uid = ? AND channel = ?", uid, channel).toArray()[0]?.read ?? 0;
  }

  all(uid: string): Map<string, number> {
    return new Map(this.sql.exec<ReadRow>("SELECT channel, read FROM chat_read WHERE uid = ?", uid).toArray().map((r) => [r.channel, r.read]));
  }

  /** 本人已读的版本: 只前进, 所以总和变了就是有变化 (GET /chats 的 ETag 用)。 */
  tag(uid: string): string {
    const r = this.sql.exec<{ n: number; s: number | null }>("SELECT COUNT(*) AS n, SUM(read) AS s FROM chat_read WHERE uid = ?", uid).one();
    return `${r.n}.${r.s ?? 0}`;
  }

  dropChannel(channel: string): void {
    this.sql.exec("DELETE FROM chat_read WHERE channel = ?", channel);
  }

  forget(uid: string): void {
    this.sql.exec("DELETE FROM chat_read WHERE uid = ?", uid);
  }
}
