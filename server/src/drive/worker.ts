import { PATH_DRIVE, PATH_DRIVE_ATTACH, PATH_DRIVE_PASS, PATH_DRIVE_SAVE } from "@hx-aioa/protocol";
import type { Env } from "../env";
import { DriveCache } from "./cache";
import { DriveFs } from "./client";
import { LAZY_OPS, OPS, unshare } from "./ops";
import { checkPass } from "./pass";
import { DriveFail, fail } from "./relay";

// 这几个要查账号目录或文件表, 交给主 Hub
const HUB_PATHS = new Set([PATH_DRIVE_PASS, PATH_DRIVE_SAVE, PATH_DRIVE_ATTACH]);
const SHARE_PREFIX = "/shares/";
// 会改网盘内容的接口: 做完 (不论成败) 把网盘的缓存版本号换新 (#159)
const WRITES = new Set(["POST /mkdir", "POST /move", "POST /copy", "POST /delete", "POST /restore", "POST /purge", "POST /trash/empty", "POST /uploads", "POST /commit"]);

/** 提前拒绝时先丢掉请求体, 否则同一连接的下一个请求跟着失败。 */
function reject(req: Request, status: number, msg: string, code?: string): Response {
  void req.body?.cancel().catch(() => undefined);
  return fail(status, msg, code);
}

/**
 * 网盘接口 (#154): Worker 验通行证后经 Service Binding 转给 Drive, 不唤醒 DO; 不是网盘路径返回 null。
 * 通行证由主 Hub 的 POST /drive/pass 签给主人, 见 docs/features/drive.md。
 */
export async function driveWorker(req: Request, env: Env, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith(`${PATH_DRIVE}/`) || HUB_PATHS.has(url.pathname)) return null;
  const owner = await checkPass(env, req, url);
  if (!owner) return reject(req, 401, "网盘通行证无效或已过期", "drive_pass");
  const fs = DriveFs.from(env);
  if (!fs) return reject(req, 503, "服务端还没接入 HX-CF-Drive", "drive_unavailable");
  const sub = url.pathname.slice(PATH_DRIVE.length);
  try {
    const key = `${req.method} ${sub}`;
    if (!LAZY_OPS.has(key)) await fs.ready();
    if (req.method === "DELETE" && sub.startsWith(SHARE_PREFIX)) return await unshare(fs, decodeURIComponent(sub.slice(SHARE_PREFIX.length)));
    const op = OPS[key];
    if (!op) return reject(req, 404, "没有这个网盘接口", "not_found");
    const cache = await DriveCache.of(fs, owner);
    try {
      return await op(fs, req, url, cache);
    } finally {
      if (WRITES.has(key)) await cache.bump();
    }
  } catch (e) {
    if (e instanceof DriveFail) {
      const res = reject(req, e.status, e.message, e.code);
      const retry = (e as { retryAfter?: string }).retryAfter;
      if (retry) res.headers.set("retry-after", retry);
      return res;
    }
    if (e instanceof URIError) return reject(req, 400, "路径编码不合法");
    console.error("网盘请求失败:", e);
    return reject(req, 502, "网盘暂时不可用");
  }
}
