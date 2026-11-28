import type { WebPushSubscription } from "@hx-aioa/protocol";

// 每个账号最多留这么多浏览器订阅, 超出删最久没更新的
export const WEBPUSH_MAX_PER_USER = 20;

export type WebPushRow = { uid: string; device: string; endpoint: string; p256dh: string; auth: string; updated: number };

/** Web Push 订阅: 每账号每设备一行, 只在订阅变了时写。 */
export class WebPushStore {
  constructor(private readonly sql: SqlStorage) {
    sql.exec(`CREATE TABLE IF NOT EXISTS webpush (
      uid TEXT NOT NULL, device TEXT NOT NULL, endpoint TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, updated INTEGER NOT NULL,
      PRIMARY KEY (uid, device)
    )`);
  }

  list(uid: string): WebPushRow[] {
    return this.sql.exec<WebPushRow>("SELECT * FROM webpush WHERE uid = ? ORDER BY updated DESC", uid).toArray();
  }

  count(uid: string): number {
    return Number(this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM webpush WHERE uid = ?", uid).one().n);
  }

  /** 返回是否真的写了库 (订阅没变时不写)。 */
  put(uid: string, device: string, sub: WebPushSubscription, now = Date.now()): boolean {
    const cur = this.sql.exec<WebPushRow>("SELECT * FROM webpush WHERE uid = ? AND device = ?", uid, device).toArray()[0];
    if (cur && cur.endpoint === sub.endpoint && cur.p256dh === sub.keys.p256dh && cur.auth === sub.keys.auth) return false;
    // 同一个 endpoint 挂到新设备 id 上 (清了本地存储): 旧行作废
    this.sql.exec("DELETE FROM webpush WHERE endpoint = ? AND NOT (uid = ? AND device = ?)", sub.endpoint, uid, device);
    this.sql.exec(
      "INSERT OR REPLACE INTO webpush (uid, device, endpoint, p256dh, auth, updated) VALUES (?, ?, ?, ?, ?, ?)",
      uid,
      device,
      sub.endpoint,
      sub.keys.p256dh,
      sub.keys.auth,
      now,
    );
    const extra = this.count(uid) - WEBPUSH_MAX_PER_USER;
    if (extra > 0) this.sql.exec("DELETE FROM webpush WHERE uid = ? AND device IN (SELECT device FROM webpush WHERE uid = ? ORDER BY updated ASC LIMIT ?)", uid, uid, extra);
    return true;
  }

  remove(uid: string, device: string): boolean {
    return this.sql.exec("DELETE FROM webpush WHERE uid = ? AND device = ?", uid, device).rowsWritten > 0;
  }

  /** 推送服务说订阅已失效 (404 / 410): 按 endpoint 删, 不管属于谁。 */
  dropEndpoint(endpoint: string): void {
    this.sql.exec("DELETE FROM webpush WHERE endpoint = ?", endpoint);
  }

  forget(uid: string): void {
    this.sql.exec("DELETE FROM webpush WHERE uid = ?", uid);
  }
}
