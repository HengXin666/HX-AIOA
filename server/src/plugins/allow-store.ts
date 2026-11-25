import type { PluginAllow, PluginManifest } from "@hx-aioa/protocol";

// 放行时的快照: 清单与提示词模板都存下, 安装与更新只用快照, 不再看市场当前版本
export type AllowRow = { meta: PluginAllow; manifest: PluginManifest; prompt: string };
type Body = { body: string };
const SEEDED = "seeded";
type Enable = { uid: string; id: string };
type Choice = { uid: string; point: string; plugin: string };

/** 白名单, 账号启用, 单选扩展点的账号选择: 三张小表, 只在 Hub 唤醒时整表读一次。 */
export class AllowStore {
  constructor(private readonly sql: SqlStorage) {
    sql.exec("CREATE TABLE IF NOT EXISTS plugin_allow (id TEXT PRIMARY KEY, body TEXT NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS plugin_enable (uid TEXT NOT NULL, id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (uid, id))");
    sql.exec("CREATE TABLE IF NOT EXISTS plugin_choice (uid TEXT NOT NULL, point TEXT NOT NULL, plugin TEXT NOT NULL, PRIMARY KEY (uid, point))");
    sql.exec("CREATE TABLE IF NOT EXISTS plugin_flag (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
  }

  /** 升级迁移是否做过; 白名单后来被清空也不再重做。 */
  seeded(): boolean {
    return this.flag(SEEDED);
  }

  markSeeded(): void {
    this.setFlag(SEEDED);
  }

  /** 一次性迁移的标记: 做过就不再做, 哪怕之后被撤销。 */
  flag(k: string): boolean {
    return this.sql.exec<{ v: string }>("SELECT v FROM plugin_flag WHERE k = ?", k).toArray().length > 0;
  }

  setFlag(k: string): void {
    this.sql.exec("INSERT OR REPLACE INTO plugin_flag (k, v) VALUES (?, ?)", k, "1");
  }

  allows(): AllowRow[] {
    return this.sql.exec<Body>("SELECT body FROM plugin_allow").toArray().map((r) => JSON.parse(r.body) as AllowRow);
  }

  enables(): Enable[] {
    return this.sql.exec<Enable>("SELECT uid, id FROM plugin_enable").toArray();
  }

  choices(): Choice[] {
    return this.sql.exec<Choice>("SELECT uid, point, plugin FROM plugin_choice").toArray();
  }

  putAllow(row: AllowRow): void {
    this.sql.exec("INSERT OR REPLACE INTO plugin_allow (id, body) VALUES (?, ?)", row.meta.id, JSON.stringify(row));
  }

  /** 撤销放行: 连同所有账号的启用与选择一起删。 */
  dropAllow(id: string): void {
    this.sql.exec("DELETE FROM plugin_allow WHERE id = ?", id);
    this.sql.exec("DELETE FROM plugin_enable WHERE id = ?", id);
    this.sql.exec("DELETE FROM plugin_choice WHERE plugin = ?", id);
  }

  setEnabled(uid: string, id: string, on: boolean, now = Date.now()): void {
    if (on) this.sql.exec("INSERT OR IGNORE INTO plugin_enable (uid, id, at) VALUES (?, ?, ?)", uid, id, now);
    else {
      this.sql.exec("DELETE FROM plugin_enable WHERE uid = ? AND id = ?", uid, id);
      this.sql.exec("DELETE FROM plugin_choice WHERE uid = ? AND plugin = ?", uid, id);
    }
  }

  setChoice(uid: string, point: string, plugin: string | null): void {
    if (plugin) this.sql.exec("INSERT OR REPLACE INTO plugin_choice (uid, point, plugin) VALUES (?, ?, ?)", uid, point, plugin);
    else this.sql.exec("DELETE FROM plugin_choice WHERE uid = ? AND point = ?", uid, point);
  }
}
