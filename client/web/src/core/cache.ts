import { CACHE_DB } from "./constants";

// IndexedDB 本地缓存: 首屏先读这里再带 ETag 校验; 一个库一张键值表, 键带账号 id, 退出登录整库清空
const STORE = "kv";
const VERSION = 1;
let db: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  db ??= new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    const req = indexedDB.open(CACHE_DB, VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return db;
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void): Promise<T | undefined> {
  return open().then(
    (d) =>
      new Promise<T | undefined>((resolve) => {
        if (!d) return resolve(undefined);
        try {
          const tx = d.transaction(STORE, mode);
          const req = fn(tx.objectStore(STORE));
          tx.oncomplete = () => resolve(req ? (req.result as T) : undefined);
          tx.onerror = () => resolve(undefined);
          tx.onabort = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      }),
  );
}

export const cacheGet = <T>(key: string): Promise<T | undefined> => run<T>("readonly", (s) => s.get(key));
export const cachePut = (key: string, value: unknown): Promise<unknown> => run("readwrite", (s) => s.put(value, key));
export const cacheDel = (key: string): Promise<unknown> => run("readwrite", (s) => s.delete(key));
export const clearCache = (): Promise<unknown> => run("readwrite", (s) => s.clear());
