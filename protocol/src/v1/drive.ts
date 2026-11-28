import { API_V1 } from "./constants";
import type { FileRef } from "./files";

// 网盘 (#154): HX-CF-Drive 目录树的一个视图, 只主人能用, 见 docs/features/drive.md。
// 主 Hub 只签通行证与处理 save / attach, 其余接口由 Worker 验通行证后经 Service Binding 转给 Drive, 不进 DO。

export const PATH_DRIVE = `${API_V1}/drive`;
export const PATH_DRIVE_PASS = `${PATH_DRIVE}/pass`;
export const PATH_DRIVE_SAVE = `${PATH_DRIVE}/save`;
export const PATH_DRIVE_ATTACH = `${PATH_DRIVE}/attach`;
// 通行证放这个请求头; 也接受 Authorization: Bearer <AUTH_TOKEN>
export const HEADER_DRIVE_PASS = "X-Aioa-Drive";
export const DRIVE_PASS_PREFIX = "dp1.";
export const DRIVE_PASS_TTL_MS = 3600_000;
// 签名直链有效期 (秒)
export const DRIVE_LINK_TTL_SEC = 6 * 3600;
export const DRIVE_PATH_MAX = 1024;
export const DRIVE_NAME_MAX = 255;
// "存到网盘" 不给 path 时存到这里
export const DRIVE_SAVE_DIR = "/聊天文件";
// 409 的 code: 服务端复制不了, 客户端改为自己上传
export const DRIVE_NEED_UPLOAD = "need_upload";
export const DRIVE_READONLY = "drive_readonly";

/** Drive 的节点 (publicNode), 时间为毫秒。 */
export type DriveNode = {
  id: string;
  name: string;
  kind: "dir" | "file";
  size: number;
  mime: string | null;
  parentId: string | null;
  createdAt: number;
  updatedAt: number;
};
export type DriveList = { path: string; items: DriveNode[] };
export type DriveSearchItem = DriveNode & { path: string };
export type DriveTrashItem = DriveNode & { deletedAt: number };
export type DrivePass = { pass: string; expires: number; root: string; whole: boolean };
export type DriveShare = { id: string; nodeId: string; name: string; url: string; expiresAt: number | null; createdAt: number; hasPassword: boolean };
export type DriveUploadInit =
  | { done: true; node: DriveNode }
  | { done: false; ticket: string; chunkSize: number; chunkCount: number };
export type DriveStats = { files: number; dirs: number; bytes: number } | null;
export type DriveAttachResult = { file: FileRef };

const SEP = "/";
const BAD_SEG = new Set([".", ".."]);
// 反斜杠与控制字符一律拒绝 (Drive 的名字校验之外再挡一层, 防止各端对路径的理解不一致)
const BAD_CHARS = /[\\\u0000-\u001f\u007f]/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** 规范化目录路径: 必须以 / 开头, 合并重复的 /, 去掉末尾 /; 含 . .. 段或非法字符时返回 null。 */
export function normalizeDrivePath(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.startsWith(SEP) || raw.length > DRIVE_PATH_MAX || BAD_CHARS.test(raw)) return null;
  const segs = raw.split(SEP).filter((s) => s !== "");
  if (segs.some((s) => BAD_SEG.has(s) || s.length > DRIVE_NAME_MAX)) return null;
  return SEP + segs.join(SEP);
}

/** 单个名字: 非空, 不含 / 与非法字符, 不是 . .. */
export function isDriveName(raw: unknown): raw is string {
  return typeof raw === "string" && raw.trim() === raw && raw.length > 0 && raw.length <= DRIVE_NAME_MAX && !raw.includes(SEP) && !BAD_CHARS.test(raw) && !BAD_SEG.has(raw);
}

export function isDriveId(raw: unknown): raw is string {
  return typeof raw === "string" && ID_RE.test(raw);
}

/** 附件月目录 (YYYY-MM) 的正则, 整盘令牌下在 /aioa 之下。 */
const MONTH = "\\d{4}-\\d{2}";
export const DRIVE_AIOA_DIR = "/aioa";

/** 聊天附件所在, 网盘里只读的位置; whole 为整盘令牌 (根目录 /), 否则令牌根就是 /aioa。 */
export function isDriveReadonly(path: string, whole: boolean): boolean {
  if (whole) return path === DRIVE_AIOA_DIR || new RegExp(`^${DRIVE_AIOA_DIR}/${MONTH}(/|$)`).test(path);
  return new RegExp(`^/${MONTH}(/|$)`).test(path);
}
