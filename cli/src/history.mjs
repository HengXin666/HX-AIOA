// 历史记录存本地: 每个群一份缓存, 只增量拉新的, 往前不够再翻页; 写成一行一条的文本供 grep / sed 节选
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "./config.mjs";
import { block } from "./format.mjs";
import { call, enc } from "./http.mjs";

const PAGE = 200;
const MAX_KEEP = 5000;
const DEFAULT_WANT = 500;

const dirOf = () => join(dataDir, "history");
const safe = (ch) => ch.replace(/[^\w.-]/g, "_");

function load(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap((l) => {
    try {
      return [JSON.parse(l)];
    } catch {
      return [];
    }
  });
}

// 撤回 / 删除的墓碑: 去掉原消息, 墓碑本身不留
function apply(map, list) {
  for (const ev of list) {
    if (ev.deleted) {
      map.delete(ev.deleted.seq);
      continue;
    }
    map.set(ev.seq, ev);
  }
}

/**
 * 同步一个群的历史到 ~/.hxaioa/history/<群>.jsonl 与 .txt; want 为本地至少要有的条数 (往前翻页补足)。
 * 返回 { file, count, first, last, fetched }。
 */
export async function syncHistory(cfg, channel, want = DEFAULT_WANT) {
  mkdirSync(dirOf(), { recursive: true, mode: 0o700 });
  const base = join(dirOf(), safe(channel));
  const map = new Map(load(`${base}.jsonl`).map((ev) => [ev.seq, ev]));
  const path = `/api/v1/chats/${enc(channel)}/messages`;
  let fetched = 0;
  // 新的: 从本地最大 seq 往后
  let since = map.size ? Math.max(...map.keys()) : 0;
  if (since) {
    for (;;) {
      const r = await call(cfg, "GET", `${path}?since=${since}&limit=${PAGE}&slim=1`);
      const list = r.messages ?? [];
      apply(map, list);
      fetched += list.length;
      if (list.length < PAGE) break;
      since = list.at(-1).seq;
    }
  }
  // 旧的: 不够 want 条就从最小 seq (没有缓存时从最新) 往前翻
  let before = map.size ? Math.min(...map.keys()) : Number.MAX_SAFE_INTEGER;
  while (map.size < Math.min(want, MAX_KEEP)) {
    const r = await call(cfg, "GET", `${path}?before=${before}&limit=${PAGE}&slim=1`);
    const list = r.messages ?? [];
    apply(map, list);
    fetched += list.length;
    if (list.length < PAGE) break;
    before = Math.min(...list.map((ev) => ev.seq));
  }
  const all = [...map.values()].sort((a, b) => a.seq - b.seq).slice(-MAX_KEEP);
  writeFileSync(`${base}.jsonl`, all.map((ev) => JSON.stringify(ev)).join("\n") + "\n", { mode: 0o600 });
  writeFileSync(`${base}.txt`, all.map(block).join("\n") + "\n", { mode: 0o600 });
  return { file: `${base}.txt`, json: `${base}.jsonl`, count: all.length, first: all[0]?.seq ?? 0, last: all.at(-1)?.seq ?? 0, fetched };
}
