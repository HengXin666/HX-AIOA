import { DRIVE_NEED_UPLOAD, DRIVE_ROOT_DIR, DRIVE_SAVE_DIR, type DriveNode, PATH_DRIVE_ATTACH, PATH_DRIVE_PASS, PATH_DRIVE_SAVE, isDriveId, normalizeDrivePath } from "@hx-aioa/protocol";
import { HEADER_INTERNAL_USER } from "../accounts/constants";
import { CODE_FORBIDDEN, CODE_NOT_FOUND, ERR_FORBIDDEN, MEMO_GROUP, POST } from "../constants";
import { OWNER, type ReqCtx, type Route, route } from "../core";
import { type FileRow, type FileStore, driveName } from "../files/store";
import { fail, json, readJson } from "../http";
import { authorOf } from "../room-access";
import { DriveFs } from "./client";
import { signPass } from "./pass";
import { migrateOld, withStamp } from "./migrate";
import { DriveFail, failOf, relayError } from "./relay";

const CODE_UNAVAILABLE = "drive_unavailable";
const FALLBACK_MIME = "application/octet-stream";
const needUpload = (why: string) => fail(409, why, DRIVE_NEED_UPLOAD);

/** 真主人: 主 Hub 上的母号或 AUTH_TOKEN; 转发到子号 DO 的请求 (带内部头) 在那里也算 owner, 要排除。 */
function realOwner(c: ReqCtx): boolean {
  if (!c.who.owner || c.req.headers.has(HEADER_INTERNAL_USER)) return false;
  return !c.who.user || c.who.user.role === "owner";
}

async function guarded(c: ReqCtx, run: (fs: DriveFs, b: Record<string, unknown>) => Promise<Response>): Promise<Response> {
  if (!realOwner(c)) return fail(403, ERR_FORBIDDEN, CODE_FORBIDDEN);
  const fs = DriveFs.from(c.core.env);
  if (!fs) return fail(503, "服务端还没接入 HX-CF-Drive", CODE_UNAVAILABLE);
  const b = ((await readJson(c.req)) ?? {}) as Record<string, unknown>;
  try {
    return await run(await fs.ready(), b);
  } catch (e) {
    if (e instanceof DriveFail) return fail(e.status, e.message, e.code);
    throw e;
  }
}

/** 换网盘通行证 (1 小时), 之后的网盘请求由 Worker 验它, 不再进 DO; 顺带把旧位置的东西迁进网盘根 (#158)。 */
const pass = (c: ReqCtx) =>
  guarded(c, async (fs) => {
    const migrated = await migrateOld(fs.unscoped()).catch((e: unknown) => (console.error("网盘迁移失败:", e), 0));
    return json({ ...(await signPass(c.core.env, (c.who.owner && c.who.user?.id) || "owner")), root: fs.root, whole: fs.whole, migrated });
  });

/** 网盘内路径换成令牌根下的路径 (给令牌根视角的客户端用)。 */
const tokenPath = (rel: string): string => (rel === "/" ? DRIVE_ROOT_DIR : `${DRIVE_ROOT_DIR}${rel}`);

/** 在 dir 下按 name 复制节点; 重名时换成 "名字 (时间)" 再试一次。复制不了返回 null。 */
async function copyInto(fs: DriveFs, id: string, dir: string, name: string): Promise<DriveNode | null> {
  const mk = await fs.json(POST, "/fs/mkdir", { path: dir });
  if (!mk.ok) throw await failOf(mk);
  for (const n of [name, withStamp(name)]) {
    const res = await fs.json(POST, "/fs/copy", { id, toPath: dir, name: n });
    if (res.ok) return (await res.json<{ node: DriveNode }>()).node;
    if (res.status === 403 || res.status === 404) return null;
    if (res.status !== 409) throw await failOf(res);
  }
  throw new DriveFail(409, "目标文件夹里已有同名文件");
}

/** R2 上的聊天文件 (95 MB 以内) 由服务端直接转给 Drive, 手机不用先下载再上传 (#157); R2 里没有返回 null。 */
async function fromR2(files: FileStore, fs: DriveFs, row: FileRow, dir: string): Promise<DriveNode | null> {
  const mk = await fs.json(POST, "/fs/mkdir", { path: dir });
  if (!mk.ok) throw await failOf(mk);
  for (const name of [row.name, withStamp(row.name)]) {
    const obj = await files.r2Body(row.id);
    if (!obj) return null;
    const fixed = new FixedLengthStream(obj.size);
    void obj.body.pipeTo(fixed.writable).catch(() => undefined);
    const q = new URLSearchParams({ path: dir, name });
    const res = await fs.fetch(POST, `/upload?${q}`, fixed.readable, { "content-type": row.mime || FALLBACK_MIME, "content-length": String(obj.size) });
    if (res.ok) return (await res.json<{ data: { node: DriveNode } }>()).data.node;
    if (res.status !== 409) throw await failOf(res);
  }
  throw new DriveFail(409, "目标文件夹里已有同名文件");
}

/** 聊天文件存到网盘: 在 Drive 上的用 Drive 复制 (0 字节); 在 R2 上的服务端转存; 令牌看不到的回 409, 客户端改为自己上传。 */
const save = (c: ReqCtx) =>
  guarded(c, async (fs, b) => {
    const row = typeof b.file === "string" ? c.core.files.row(b.file) : null;
    if (!row?.done) return fail(404, "文件不存在或还没传完", CODE_NOT_FOUND);
    const dir = normalizeDrivePath(b.path ?? DRIVE_SAVE_DIR);
    if (!dir) return fail(400, "路径不合法");
    if (row.store !== "cfd" || !row.ext) {
      const node = row.store === "r2" ? await fromR2(c.core.files, fs, row, dir) : null;
      return node ? json({ node, path: dir }) : needUpload("文件不在服务端存储里, 需要从手机上传");
    }
    // 附件节点在网盘根外, 要用令牌根视角复制, 目标换算成令牌根下的网盘路径
    const node = await copyInto(fs.unscoped(), row.ext, tokenPath(dir), row.name);
    return node ? json({ node, path: dir }) : needUpload("网盘令牌看不到这个文件, 需要从手机上传");
  });

/** 网盘文件发到群: 复制进附件目录, 登记成已传完的 cfd 文件, 客户端再带 file 发消息。 */
const attach = (c: ReqCtx) =>
  guarded(c, async (fs, b) => {
    if (!isDriveId(b.id)) return fail(400, "id 不合法");
    if (!c.core.files.drive) return needUpload("聊天附件没接入 Drive, 需要从手机上传");
    const st = await fs.fetch("GET", `/fs/stat?id=${encodeURIComponent(b.id)}`);
    if (!st.ok) return relayError(st);
    const node = (await st.json<{ node: DriveNode }>()).node;
    if (node.kind !== "file") return fail(400, "只能发文件");
    const grp = typeof b.channel === "string" && b.channel ? b.channel : MEMO_GROUP;
    const root = fs.unscoped();
    const dir = root.attachDir();
    if (!dir) return needUpload("附件目录不在网盘令牌范围内, 需要从手机上传");
    const ref = c.core.files.create(grp, node.name, node.size, node.mime || FALLBACK_MIME, authorOf(c.core, c.who) ?? "owner", "cfd");
    const copied = await copyInto(root, node.id, dir, driveName(ref.id, node.name));
    // 没登记完的行由每天的清理删掉
    if (!copied) return needUpload("附件目录不在网盘令牌范围内, 需要从手机上传");
    c.core.files.done(ref.id, node.size, copied.id);
    return json({ file: ref });
  });

export const DRIVE_ROUTES: Route[] = [route(POST, PATH_DRIVE_PASS, OWNER, pass), route(POST, PATH_DRIVE_SAVE, OWNER, save), route(POST, PATH_DRIVE_ATTACH, OWNER, attach)];
