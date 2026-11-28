import { DRIVE_NEED_UPLOAD, DRIVE_SAVE_DIR, type DriveNode, PATH_DRIVE_ATTACH, PATH_DRIVE_PASS, PATH_DRIVE_SAVE, isDriveId, normalizeDrivePath } from "@hx-aioa/protocol";
import { HEADER_INTERNAL_USER } from "../accounts/constants";
import { CODE_FORBIDDEN, CODE_NOT_FOUND, ERR_FORBIDDEN, MEMO_GROUP, POST } from "../constants";
import { OWNER, type ReqCtx, type Route, route } from "../core";
import { driveName } from "../files/store";
import { fail, json, readJson } from "../http";
import { authorOf } from "../room-access";
import { DriveFs } from "./client";
import { signPass } from "./pass";
import { DriveFail, failOf, guardPath, relayError } from "./relay";

const CODE_UNAVAILABLE = "drive_unavailable";
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
    return await run(fs, b);
  } catch (e) {
    if (e instanceof DriveFail) return fail(e.status, e.message, e.code);
    throw e;
  }
}

/** 换网盘通行证 (1 小时), 之后的网盘请求由 Worker 验它, 不再进 DO。 */
const pass = (c: ReqCtx) =>
  guarded(c, async (fs) => json({ ...(await signPass(c.core.env, (c.who.owner && c.who.user?.id) || "owner")), root: fs.root, whole: fs.whole }));

/** 在 dir 下按 name 复制节点; 重名时换成 "名字 (时间)" 再试一次。复制不了返回 null。 */
async function copyInto(fs: DriveFs, id: string, dir: string, name: string): Promise<DriveNode | null> {
  const mk = await fs.json("POST", "/fs/mkdir", { path: dir });
  if (!mk.ok) throw await failOf(mk);
  for (const n of [name, withStamp(name)]) {
    const res = await fs.json("POST", "/fs/copy", { id, toPath: dir, name: n });
    if (res.ok) return (await res.json<{ node: DriveNode }>()).node;
    if (res.status === 403 || res.status === 404) return null;
    if (res.status !== 409) throw await failOf(res);
  }
  throw new DriveFail(409, "目标文件夹里已有同名文件");
}

function withStamp(name: string): string {
  const dot = name.lastIndexOf(".");
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
  return dot > 0 ? `${name.slice(0, dot)} (${stamp})${name.slice(dot)}` : `${name} (${stamp})`;
}

/** 聊天文件存到网盘: 在 Drive 上的用 Drive 复制 (0 字节); 在 R2 上或令牌看不到的回 409, 客户端改为自己上传。 */
const save = (c: ReqCtx) =>
  guarded(c, async (fs, b) => {
    const row = typeof b.file === "string" ? c.core.files.row(b.file) : null;
    if (!row?.done) return fail(404, "文件不存在或还没传完", CODE_NOT_FOUND);
    const dir = normalizeDrivePath(b.path ?? DRIVE_SAVE_DIR);
    if (!dir) return fail(400, "路径不合法");
    guardPath(fs, dir);
    if (row.store !== "cfd" || !row.ext) return needUpload("文件在 R2 上, 需要从手机上传");
    const node = await copyInto(fs, row.ext, dir, row.name);
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
    const ref = c.core.files.create(grp, node.name, node.size, node.mime || "application/octet-stream", authorOf(c.core, c.who) ?? "owner", "cfd");
    const copied = await copyInto(fs, node.id, fs.attachDir(), driveName(ref.id, node.name));
    // 没登记完的行由每天的清理删掉
    if (!copied) return needUpload("附件目录不在网盘令牌范围内, 需要从手机上传");
    c.core.files.done(ref.id, node.size, copied.id);
    return json({ file: ref });
  });

export const DRIVE_ROUTES: Route[] = [route(POST, PATH_DRIVE_PASS, OWNER, pass), route(POST, PATH_DRIVE_SAVE, OWNER, save), route(POST, PATH_DRIVE_ATTACH, OWNER, attach)];
