// 网盘文件缓存 (#155, 移植自 HX-CF-Drive web/src/lib/imgcache.ts): 预览或缩略图取过的文件留在本机,
// 再预览, 再下载都直接用, 不再走网络 ("秒传")。
// 两层: 内存里的 object URL (按字节 LRU), 浏览器 Cache Storage (刷新后仍在, 也按字节 LRU); 退出登录时清空。
import type { DriveNode } from "@hx-aioa/protocol";
import { authChanged } from "./auth";
import { linkOf } from "./drive";

const MB = 1024 * 1024;
const INDEX = "aioa.drive.blobs";
const STORE = "aioa-drive-v1";
const MEM_CAP = 200 * MB;
const DISK_CAP = 500 * MB;
const PARALLEL = 4;
const FLUSH_MS = 1000;
/** 单个文件超过这个就不进缓存 (视频这类大文件边播边取, 不整个下载) */
export const CACHE_MAX = 64 * MB;
/** 网格视图自动加载缩略图的上限 */
export const THUMB_MAX = 6 * MB;

const keyOf = (n: DriveNode) => `${n.id}:${n.size}:${n.updatedAt}`;
export const isImage = (n: DriveNode) =>
  n.kind === "file" && Boolean(n.mime?.startsWith("image/"));
export const cacheable = (n: DriveNode) =>
  n.kind === "file" && n.size > 0 && n.size <= CACHE_MAX;

// ---------- 内存层 ----------
const mem = new Map<string, { url: string; size: number }>(); // Map 保持插入顺序, 头部最旧
let memBytes = 0;
function memPut(k: string, b: Blob): string {
  const url = URL.createObjectURL(b);
  mem.set(k, { url, size: b.size });
  memBytes += b.size;
  while (memBytes > MEM_CAP && mem.size > 1) {
    const [old, v] = mem.entries().next().value as [
      string,
      { url: string; size: number },
    ];
    mem.delete(old);
    memBytes -= v.size;
    URL.revokeObjectURL(v.url);
  }
  return url;
}
function memGet(k: string): string | null {
  const v = mem.get(k);
  if (!v) return null;
  mem.delete(k);
  mem.set(k, v);
  return v.url;
}

// ---------- 磁盘层 (Cache Storage, 只在安全上下文可用); 索引只在内存维护, 防抖写回 ----------
const hasDisk = () => typeof caches !== "undefined" && isSecureContext;
const diskUrl = (k: string) => `/__drive/${encodeURIComponent(k)}`;
let idx: Map<string, number> | null = null;
let idxBytes = 0;
let flushTimer: ReturnType<typeof setTimeout> | undefined;
function index(): Map<string, number> {
  if (idx) return idx;
  idx = new Map();
  try {
    for (const [k, n] of JSON.parse(localStorage.getItem(INDEX) ?? "[]") as [
      string,
      number,
    ][])
      idx.set(k, n);
  } catch {
    /* 坏了就当空的 */
  }
  idxBytes = [...idx.values()].reduce((a, b) => a + b, 0);
  window.addEventListener("pagehide", flushIdx);
  return idx;
}
function flushIdx() {
  clearTimeout(flushTimer);
  flushTimer = undefined;
  if (idx)
    try {
      localStorage.setItem(INDEX, JSON.stringify([...idx]));
    } catch {
      /* 配额满了: 下次重建 */
    }
}
function touch(k: string, n: number) {
  const m = index();
  const old = m.get(k);
  if (old !== undefined) {
    m.delete(k);
    idxBytes -= old;
  }
  m.set(k, n);
  idxBytes += n;
  if (flushTimer === undefined) flushTimer = setTimeout(flushIdx, FLUSH_MS);
}
async function diskGet(k: string): Promise<Blob | null> {
  if (!hasDisk() || !index().has(k)) return null;
  const r = await (
    await caches.open(STORE)
  )
    .match(diskUrl(k))
    .catch(() => undefined);
  if (!r) return null;
  touch(k, Number(r.headers.get("Content-Length")) || 0);
  return r.blob();
}
async function diskPut(k: string, b: Blob) {
  if (!hasDisk()) return;
  const c = await caches.open(STORE);
  await c.put(
    diskUrl(k),
    new Response(b, {
      headers: { "Content-Type": b.type, "Content-Length": String(b.size) },
    }),
  );
  touch(k, b.size);
  const m = index();
  while (idxBytes > DISK_CAP && m.size > 1) {
    const [old, n] = m.entries().next().value as [string, number];
    m.delete(old);
    idxBytes -= n;
    await c.delete(diskUrl(old));
  }
}

// ---------- 取文件: 去重 + 并发上限 ----------
const inflight = new Map<string, Promise<string>>();
let running = 0;
const queue: (() => void)[] = [];
const slot = () =>
  new Promise<void>((res) => {
    if (running < PARALLEL) {
      running++;
      res();
    } else
      queue.push(() => {
        running++;
        res();
      });
  });
const release = () => {
  running--;
  queue.shift()?.();
};

/** 已在内存里就同步返回 */
export const peek = (n: DriveNode): string | null => memGet(keyOf(n));
/** 本机有没有 (内存或磁盘): 下载按钮据此显示 "已缓存" */
export const cached = (n: DriveNode): boolean =>
  mem.has(keyOf(n)) || (hasDisk() && index().has(keyOf(n)));

/** 文件的 object URL: 内存 -> 磁盘 -> 网络 (签直链取一次) */
export function load(n: DriveNode): Promise<string> {
  const k = keyOf(n);
  const hit = memGet(k);
  if (hit) return Promise.resolve(hit);
  const p =
    inflight.get(k) ??
    (async () => {
      try {
        const d = await diskGet(k);
        if (d) return memPut(k, d);
        await slot();
        try {
          const r = await fetch(await linkOf(n.id));
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const b = await r.blob();
          void diskPut(k, b).catch(() => {});
          return memPut(k, b);
        } finally {
          release();
        }
      } finally {
        inflight.delete(k);
      }
    })();
  inflight.set(k, p);
  return p;
}

/** 下载: 缓存里有就直接从本机存, 没有再签直链交给浏览器下载 */
export async function saveAs(n: DriveNode): Promise<"cache" | "net"> {
  const local = cached(n) ? await load(n) : null;
  const a = document.createElement("a");
  a.href = local ?? (await linkOf(n.id));
  a.download = n.name;
  a.click();
  return local ? "cache" : "net";
}

export async function clearBlobs(): Promise<void> {
  for (const v of mem.values()) URL.revokeObjectURL(v.url);
  mem.clear();
  memBytes = 0;
  clearTimeout(flushTimer);
  flushTimer = undefined;
  idx = new Map();
  idxBytes = 0;
  localStorage.removeItem(INDEX);
  if (hasDisk()) await caches.delete(STORE).catch(() => {});
}

// 退出登录: 别把文件留在这台设备上
authChanged.on((u) => {
  if (!u) void clearBlobs();
});
