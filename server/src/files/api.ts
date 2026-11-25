import {
  FILE_DEFAULT_MIME,
  FILE_LINK_TTL_MS,
  FILE_MAX_BYTES,
  FILE_NAME_MAX,
  FILE_UPLOAD_TTL_MS,
  type FileCreated,
  type FileLink,
  type FileRef,
  PATH_FILE,
  PATH_FILE_LINK,
  PATH_FILES,
  type Scope,
} from "@hx-aioa/protocol";
import { canRead } from "../api-chats";
import { CODE_BAD_REQUEST, CODE_FORBIDDEN, CODE_NOT_FOUND, DELETE, ERR_FORBIDDEN, GET, MEMO_GROUP, POST } from "../constants";
import { type Core, type Principal, type ReqCtx, ROOM, type Route, route } from "../core";
import { ApiFail, fail, json, readJson } from "../http";
import { authorOf, rank, roleIn } from "../room-access";
import { DriveError } from "./drive";
import { storageOf } from "./storage";
import { ticketPath } from "./ticket";

const SEND_SCOPE: Scope = "messages:send";
const MIME_RE = /^[\w.+-]+\/[\w.+-]+$/;
const CODE_UNAVAILABLE = "files_unavailable";
const CODE_QUOTA = "quota";
const STATUS_QUOTA = 507;

/** 上传者: 人按账号 id, Agent / 脚本按 key。 */
function uploaderOf(core: Core, who: Principal): string {
  return authorOf(core, who) ?? (who.owner ? "owner" : `key:${who.key.id}`);
}

/** 能往哪个群传: 主人任意 (默认备忘); 成员只能传自己所在的群; Agent 只能传自己的群。 */
function uploadGroup(core: Core, who: Principal, channel: string | undefined): string {
  if (who.owner) return channel || MEMO_GROUP;
  if (who.member) {
    if (channel && roleIn(core, who, channel)) return channel;
    throw new ApiFail(403, CODE_FORBIDDEN, ERR_FORBIDDEN);
  }
  const home = who.key.channels[0];
  if (who.key.scopes.includes(SEND_SCOPE) && home && (!channel || channel === home)) return home;
  throw new ApiFail(403, CODE_FORBIDDEN, ERR_FORBIDDEN);
}

/** 发消息时把附件 id 换成引用: 必须已传完, 且是发送者能读的群里的文件。 */
export function attachFile(core: Core, who: Principal, id: unknown, channel: string | undefined): FileRef | string | undefined {
  if (id === undefined || id === null || id === "") return undefined;
  if (typeof id !== "string") return "file 应为文件 id";
  const row = core.files.row(id);
  if (!row?.done) return "文件不存在或还没传完";
  if (row.grp !== (channel || MEMO_GROUP) && !canRead(core, who, row.grp)) return ERR_FORBIDDEN;
  return { id: row.id, name: row.name, size: row.size, mime: row.mime };
}

function mustEnabled(core: Core): void {
  if (!core.files.enabled) throw new ApiFail(503, CODE_UNAVAILABLE, "服务端还没绑定 R2 文件桶, 也没接入 HX-CF-Drive");
}

async function create(c: ReqCtx): Promise<Response> {
  mustEnabled(c.core);
  const b = (await readJson(c.req)) as Record<string, unknown> | undefined;
  const name = typeof b?.name === "string" ? b.name.trim().slice(0, FILE_NAME_MAX) : "";
  const size = typeof b?.size === "number" ? Math.floor(b.size) : -1;
  const mime = typeof b?.mime === "string" && MIME_RE.test(b.mime) ? b.mime.toLowerCase() : FILE_DEFAULT_MIME;
  if (!name || name.includes("/")) return fail(400, "需要文件名 (不含 /)", CODE_BAD_REQUEST);
  if (size < 0 || size > FILE_MAX_BYTES) return fail(413, `单个文件上限 ${FILE_MAX_BYTES / 1024 / 1024} MB`, CODE_BAD_REQUEST);
  const grp = uploadGroup(c.core, c.who, typeof b?.channel === "string" ? b.channel : undefined);
  const store = c.core.files.pick(size, storageOf(await c.core.config.settings()));
  if (Array.isArray(store)) {
    const [status, msg] = store;
    return fail(status, msg, status === STATUS_QUOTA ? CODE_QUOTA : status === 503 ? CODE_UNAVAILABLE : CODE_BAD_REQUEST);
  }
  const file = c.core.files.create(grp, name, size, mime, uploaderOf(c.core, c.who), store);
  const expires = Date.now() + FILE_UPLOAD_TTL_MS;
  let upload = await ticketPath(c.core.env, "up", file.id, expires, size, store);
  // Drive 里的文件名带上原名, 方便在 Drive 后台认; 不签名, 只影响显示
  if (store === "cfd") upload += `&n=${encodeURIComponent(name)}`;
  return json({ file, upload, expires } satisfies FileCreated);
}

async function link(c: ReqCtx): Promise<Response> {
  mustEnabled(c.core);
  const row = c.core.files.row(decodeURIComponent(c.params[0] ?? ""));
  if (!row?.done) return fail(404, "文件不存在或已删除", CODE_NOT_FOUND);
  if (!canRead(c.core, c.who, row.grp)) return fail(403, ERR_FORBIDDEN, CODE_FORBIDDEN);
  if (row.store === "cfd") {
    try {
      return json((await c.core.files.driveLink(row)) satisfies FileLink | null);
    } catch (e) {
      if (e instanceof DriveError) return fail(e.status === 404 ? 404 : 502, e.message, e.status === 404 ? CODE_NOT_FOUND : CODE_UNAVAILABLE);
      return fail(503, (e as Error).message, CODE_UNAVAILABLE);
    }
  }
  const expires = Date.now() + FILE_LINK_TTL_MS;
  const url = `${await ticketPath(c.core.env, "dl", row.id, expires, 0)}&n=${encodeURIComponent(row.name)}`;
  return json({ url, expires } satisfies FileLink);
}

async function remove(c: ReqCtx): Promise<Response> {
  const row = c.core.files.row(decodeURIComponent(c.params[0] ?? ""));
  if (!row) return fail(404, "文件不存在", CODE_NOT_FOUND);
  const admin = !c.who.owner && !!c.who.member && rank(roleIn(c.core, c.who, row.grp) ?? "member") >= rank("admin");
  if (!c.who.owner && !admin && row.by !== uploaderOf(c.core, c.who)) return fail(403, ERR_FORBIDDEN, CODE_FORBIDDEN);
  await c.core.files.remove(row.id);
  return json({ ok: true });
}

export const FILE_ROUTES: Route[] = [
  route(POST, PATH_FILES, ROOM, create),
  route(GET, PATH_FILES, ROOM, async (c) => (c.who.owner ? json(c.core.files.usage(storageOf(await c.core.config.settings()))) : fail(403, ERR_FORBIDDEN, CODE_FORBIDDEN))),
  route(GET, PATH_FILE_LINK, ROOM, link),
  route(DELETE, PATH_FILE, ROOM, remove),
];
