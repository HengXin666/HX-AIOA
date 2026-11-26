import { DatabaseSync } from "node:sqlite";

// 测试用: 用 node:sqlite 模拟 DO 的 SqlStorage (只实现服务端用到的 exec / toArray / one / rowsWritten)
export function memSql(): SqlStorage {
  const db = new DatabaseSync(":memory:");
  return {
    exec(query: string, ...binds: unknown[]) {
      const st = db.prepare(query);
      const read = /^\s*select/i.test(query) || /\sreturning\s/i.test(query);
      const rows = read ? (st.all(...(binds as never[])) as Record<string, unknown>[]) : [];
      const written = read ? 0 : Number(st.run(...(binds as never[])).changes);
      return {
        toArray: () => rows,
        one: () => {
          if (rows.length !== 1) throw new Error(`期望 1 行, 实际 ${rows.length}`);
          return rows[0];
        },
        rowsWritten: written,
      };
    },
  } as unknown as SqlStorage;
}
