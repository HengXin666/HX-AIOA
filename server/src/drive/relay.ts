import { json } from "../http";
import type { DriveFs } from "./client";

// Drive 的英文报错换成给人看的中文; 没收录的原样带上
const MESSAGES: Record<string, string> = {
  "target exists": "同名的文件或文件夹已存在",
  "not found": "不存在或已删除",
  "target not found": "目标文件夹不存在",
  "target dir not found": "目标文件夹不存在",
  "search rate limited": "搜索太频繁, 稍后再试",
  "cannot move a dir into itself": "不能移到它自己里面",
  "not in trash": "不在回收站里",
  "invalid name": "名字不合法",
  "not a file": "不是文件",
  "bad or expired upload ticket": "上传票据无效或已过期, 请重新上传",
  "a file with that name exists": "已有同名文件",
  "outside token root": "不在网盘里",
  "scope not found": "网盘根目录不存在",
};
// 越界 (Drive 403 outside token root) 对外统一成 404, 不暴露网盘外有什么
const OUTSIDE = new Set(["outside token root"]);

export class DriveFail extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = "drive",
  ) {
    super(message);
  }
}

export const fail = (status: number, error: string, code = "drive") => json({ error, code }, status);

/** Drive 的失败转成我们的: 4xx 原样, 503 原样 (带 Retry-After), 其他 5xx 记成 502。 */
export async function failOf(res: Response): Promise<DriveFail & { retryAfter?: string }> {
  const raw = await res.json<{ error?: string }>().then((j) => j.error ?? "", () => "");
  const msg = MESSAGES[raw] ?? (raw ? `网盘出错: ${raw}` : `网盘出错 (HTTP ${res.status})`);
  const status = OUTSIDE.has(raw) ? 404 : res.status < 500 || res.status === 503 ? res.status : 502;
  const f = Object.assign(new DriveFail(status, msg), { retryAfter: res.headers.get("retry-after") ?? undefined });
  return f;
}

export async function relayError(res: Response): Promise<Response> {
  const f = await failOf(res);
  const out = fail(f.status, f.message, f.code);
  if (f.retryAfter) out.headers.set("retry-after", f.retryAfter);
  return out;
}

/** 成功就把 Drive 的 JSON 交给 map, 失败转成中文报错。 */
export async function relay<T>(res: Response, map: (body: T) => unknown = (b) => b): Promise<Response> {
  if (!res.ok) return relayError(res);
  return json(map(await res.json<T>()));
}

/** Drive 的绝对路径换成本客户端根 (收窄时是网盘根) 下的相对路径; 不在根下返回 null。 */
export function toRel(fs: DriveFs, abs: string): string | null {
  const root = fs.rootAbs;
  if (root === "/") return abs;
  if (abs === root) return "/";
  return abs.startsWith(`${root}/`) ? abs.slice(root.length) : null;
}
