import { TODO_COLL, TODO_LEGACY_ID, TODO_PLUGIN, TODO_V2, todoRowId, type TodoBody, type TodoItem } from "@hx-aioa/protocol";
import type { AllowRow } from "./allow-store";
import type { PDataStore } from "./pdata";

export type Tx = <T>(fn: () => T) => T;
type Body = { body: string };
type OldTodo = { grp: string; id: string; body: string };
const FLAG = "todo-v2";
const OLD_TABLE = "todo";

/** 旧 todo 快照补上 v2 数据声明 (集合 items, data:own), 版本号不变; 管理员放行新版后整份换掉。 */
export function asTodoV2<T extends AllowRow["manifest"]>(m: T): T {
  return m.id === TODO_PLUGIN || m.id === TODO_LEGACY_ID ? { ...m, ...TODO_V2, id: TODO_PLUGIN } : m;
}

function moveRow(sql: SqlStorage, table: string, edit: (body: Record<string, unknown>) => void): void {
  const old = sql.exec<Body>(`SELECT body FROM ${table} WHERE id = ?`, TODO_LEGACY_ID).toArray()[0];
  if (!old) return;
  const body = JSON.parse(old.body) as Record<string, unknown>;
  edit(body);
  sql.exec(`INSERT OR IGNORE INTO ${table} (id, body) VALUES (?, ?)`, TODO_PLUGIN, JSON.stringify(body));
  sql.exec(`DELETE FROM ${table} WHERE id = ?`, TODO_LEGACY_ID);
}

// 白名单, 启用, 单选, 安装记录, 群里 Agent 的 plugin 字段里的旧 id 改成新 id; 群与工作台 (plugin-todo) 不改名
function renameIds(sql: SqlStorage, has: Set<string>): void {
  if (has.has("plugin_allow")) moveRow(sql, "plugin_allow", (b) => {
    const row = b as unknown as AllowRow;
    row.meta = { ...row.meta, id: TODO_PLUGIN };
    row.manifest = asTodoV2(row.manifest);
  });
  if (has.has("plugin")) moveRow(sql, "plugin", (b) => {
    (b.install as { id: string }).id = TODO_PLUGIN;
  });
  if (has.has("plugin_enable")) {
    sql.exec("UPDATE OR IGNORE plugin_enable SET id = ? WHERE id = ?", TODO_PLUGIN, TODO_LEGACY_ID);
    sql.exec("DELETE FROM plugin_enable WHERE id = ?", TODO_LEGACY_ID);
  }
  if (has.has("plugin_choice")) sql.exec("UPDATE plugin_choice SET plugin = ? WHERE plugin = ?", TODO_PLUGIN, TODO_LEGACY_ID);
  if (!has.has("chat_meta")) return;
  const tag = `"plugin":"${TODO_LEGACY_ID}"`;
  for (const r of sql.exec<{ channel: string; body: string }>("SELECT channel, body FROM chat_meta WHERE instr(body, ?) > 0", tag).toArray()) {
    const meta = JSON.parse(r.body) as { agents?: { plugin?: string }[] };
    for (const a of meta.agents ?? []) if (a.plugin === TODO_LEGACY_ID) a.plugin = TODO_PLUGIN;
    sql.exec("UPDATE chat_meta SET body = ? WHERE channel = ?", JSON.stringify(meta), r.channel);
  }
}

// 旧表一行一条, 搬进主人账号的 pdata; 已有同 id 的行跳过; 保留原来的 updated
function moveData(sql: SqlStorage, pdata: PDataStore, owner: string): number {
  let n = 0;
  for (const r of sql.exec<OldTodo>(`SELECT grp, id, body FROM ${OLD_TABLE}`).toArray()) {
    const t = JSON.parse(r.body) as TodoItem;
    // 旧行的全部字段都带过来 (含 GitHub 关联, 同步状态, 完成时间), 只去掉 id 与 updated
    const { id: _id, updated: _u, ...rest } = t;
    const body: TodoBody = { channel: r.grp, ...rest };
    if (pdata.importRow(owner, TODO_PLUGIN, TODO_COLL, todoRowId(r.grp, r.id), body, t.updated)) n += 1;
  }
  sql.exec(`DROP TABLE ${OLD_TABLE}`);
  return n;
}

/**
 * 一次性迁移 (#101): 在一个事务里改 id, 搬数据, 删旧表, 打标记; 失败整体回滚, 下次唤醒重来。
 * 标记之后每次唤醒只多一次按主键的读。返回搬过来的条数。
 */
export function migrateTodo(sql: SqlStorage, pdata: PDataStore, owner: () => string, tx: Tx): number {
  sql.exec("CREATE TABLE IF NOT EXISTS plugin_flag (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
  if (sql.exec("SELECT v FROM plugin_flag WHERE k = ?", FLAG).toArray().length) return 0;
  return tx(() => {
    // 这些表由各自的 store 建, 装配顺序不同或全新部署时可能还没有
    const has = new Set(sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").toArray().map((r) => r.name));
    renameIds(sql, has);
    const n = has.has(OLD_TABLE) ? moveData(sql, pdata, owner()) : 0;
    sql.exec("INSERT OR REPLACE INTO plugin_flag (k, v) VALUES (?, ?)", FLAG, "1");
    return n;
  });
}
