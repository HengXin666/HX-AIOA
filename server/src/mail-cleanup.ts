import type { Env } from "./env";

// 临时邮箱库 (cloudflare_temp_email) 定期清理: 只删超期邮件, 地址保留
export const MAIL_CLEANUP_CRON = "0 19 * * *"; // 每天 03:00 (UTC+8)
const KEEP_DAYS = 7;
const BATCH = 500;
// 免费计划每次调用最多 50 条查询, 留余量
const MAX_BATCHES = 40;

export async function cleanupTempMail(env: Env): Promise<number> {
  const db = env.TEMP_MAIL_DB;
  if (!db) return 0;
  const sql = `DELETE FROM raw_mails WHERE id IN (SELECT id FROM raw_mails WHERE created_at < datetime('now', '-${KEEP_DAYS} days') LIMIT ${BATCH})`;
  let total = 0;
  for (let i = 0; i < MAX_BATCHES; i++) {
    const n = (await db.prepare(sql).run()).meta.changes ?? 0;
    total += n;
    if (n < BATCH) break;
  }
  return total;
}
