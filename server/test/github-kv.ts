// 测试用: 内存版 DurableObjectStorage (get / put / delete 单个或批量), 记写入行数
export function memKv() {
  const map = new Map<string, unknown>();
  let rows = 0;
  const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));
  const storage = {
    async get(k: string | string[]) {
      if (Array.isArray(k)) return new Map(k.filter((x) => map.has(x)).map((x) => [x, clone(map.get(x))]));
      return clone(map.get(k));
    },
    async put(k: string | Record<string, unknown>, v?: unknown) {
      const entries = typeof k === "string" ? [[k, v] as const] : Object.entries(k);
      for (const [key, val] of entries) map.set(key, clone(val));
      rows += entries.length;
    },
    async delete(k: string | string[]) {
      for (const key of Array.isArray(k) ? k : [k]) map.delete(key);
      return true;
    },
  } as unknown as DurableObjectStorage;
  return { map, storage, writes: () => rows };
}
