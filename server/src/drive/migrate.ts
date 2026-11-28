import { DRIVE_AIOA_DIR, DRIVE_ROOT_DIR, DRIVE_SAVE_DIR, type DriveNode } from "@hx-aioa/protocol";
import type { DriveFs } from "./client";
import { failOf } from "./relay";

// 系统目录: 附件月目录; 网盘根本身。都不迁
const MONTH_RE = /^\d{4}-\d{2}$/;
const ROOT_NAME = DRIVE_ROOT_DIR.slice(1);
// 一次 pass 最多发这么多个 Drive 请求, 没迁完的下次 pass 接着迁
const CALL_BUDGET = 40;
const DONE_TTL_MS = 10 * 60_000;
const done = new Map<string, number>();

export const joinPath = (dir: string, name: string): string => (dir === "/" ? `/${name}` : `${dir}/${name}`);

/** 重名时用的新名字: "名字 (时间).扩展名"。 */
export function withStamp(name: string, now = Date.now()): string {
  const dot = name.lastIndexOf(".");
  const stamp = new Date(now).toISOString().slice(0, 19).replace(/[-:T]/g, "");
  return dot > 0 ? `${name.slice(0, dot)} (${stamp})${name.slice(dot)}` : `${name} (${stamp})`;
}

/**
 * 旧位置 (相对令牌根) 与其中要迁的条目 (#158)。根是 /aioa (或别处) 时, 令牌根下除附件月目录与网盘根外都是以前网盘里建的;
 * 根是 / 时, Drive 根下可能是主人自己的文件, 只迁以前的 "存到网盘" 目录与 /aioa 下非系统的条目。
 */
export function sourcesOf(tokenAbs: string): { dir: string; pick: (name: string) => boolean }[] {
  const own = (name: string) => !MONTH_RE.test(name) && name !== ROOT_NAME;
  if (tokenAbs !== "/") return [{ dir: "/", pick: own }];
  return [
    { dir: DRIVE_AIOA_DIR, pick: (name) => !MONTH_RE.test(name) },
    { dir: "/", pick: (name) => name === DRIVE_SAVE_DIR.slice(1) },
  ];
}

class Mover {
  calls = 0;
  moved = 0;
  constructor(private readonly fs: DriveFs) {}

  get spent(): boolean {
    return this.calls >= CALL_BUDGET;
  }

  async list(dir: string): Promise<DriveNode[] | null> {
    this.calls++;
    const res = await this.fs.fetch("GET", `/fs/list?path=${encodeURIComponent(dir)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw await failOf(res);
    return (await res.json<{ children: DriveNode[] }>()).children;
  }

  private async move(id: string, toPath: string, name?: string): Promise<number> {
    this.calls++;
    const res = await this.fs.json("POST", "/fs/move", { id, toPath, name });
    if (res.ok || res.status === 409) return res.status;
    throw await failOf(res);
  }

  /** 把 node 移进 dst; 同名文件夹合并, 同名文件加时间后缀。 */
  async into(node: DriveNode, src: string, dst: string): Promise<void> {
    if (this.spent) return;
    const st = await this.move(node.id, dst);
    if (st !== 409) {
      this.moved++;
      return;
    }
    if (node.kind === "dir") return this.merge(joinPath(src, node.name), joinPath(dst, node.name));
    if ((await this.move(node.id, dst, withStamp(node.name))) !== 409) this.moved++;
  }

  /** 逐个移走 src 的子项, 移空后把 src 放进回收站 (令牌根视角的回收站, 网盘里看不到)。 */
  async merge(src: string, dst: string): Promise<void> {
    for (const ch of (await this.list(src)) ?? []) await this.into(ch, src, dst);
    if (this.spent) return;
    const left = await this.list(src);
    if (left?.length !== 0) return;
    this.calls++;
    await this.fs.json("POST", "/fs/delete", { path: src });
  }
}

/**
 * 把旧位置里的东西一次性迁进网盘根 (Drive move, 不复制字节)。幂等: 迁走的不会再出现在旧位置, 再跑一遍只多几次 list。
 * fs 必须是令牌根视角 (unscoped)。返回这次迁了多少个条目。
 */
export async function migrateOld(fs: DriveFs, now = Date.now()): Promise<number> {
  const key = `${fs.origin} ${fs.tokenAbs}`;
  const at = done.get(key);
  if (at !== undefined && now - at < DONE_TTL_MS) return 0;
  const m = new Mover(fs);
  for (const s of sourcesOf(fs.tokenAbs)) {
    const items = (await m.list(s.dir)) ?? [];
    for (const it of items) {
      if (!s.pick(it.name)) continue;
      // 整盘时 /aioa/drive 是旧的网盘根: 合并内容而不是整个搬进来
      if (s.dir === DRIVE_AIOA_DIR && it.name === ROOT_NAME && it.kind === "dir") await m.merge(joinPath(s.dir, it.name), DRIVE_ROOT_DIR);
      else await m.into(it, s.dir, DRIVE_ROOT_DIR);
      if (m.spent) break;
    }
    if (m.spent) break;
  }
  if (!m.spent) done.set(key, now);
  if (m.moved) console.log(`网盘: 从旧位置迁入网盘根 ${m.moved} 项`);
  return m.moved;
}
