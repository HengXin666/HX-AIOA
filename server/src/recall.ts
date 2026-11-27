import {
  DELETE_MODES,
  PATH_EVENT_BY_SEQ,
  QUERY_MODE,
  TOMBSTONE_KEEP_MS,
  type ChatSyncFrame,
  type DeleteMode,
  type Envelope,
} from "@hx-aioa/protocol";
import { originOf } from "./api-events";
import { CODE_BAD_REQUEST, CODE_FORBIDDEN, CODE_NOT_FOUND, DELETE, ERR_NO_RESOURCE } from "./constants";
import { type Core, type Principal, ROOM, type ReqCtx, type Route, route } from "./core";
import { authorOf, rank, roleIn } from "./room-access";
import { groupOf } from "./store";
import { ApiFail, fail, json } from "./http";

const TEXT_RECALLED = "消息已撤回";
const TEXT_DELETED = "消息已删除";

/** 墓碑: 沿用原 id, 内容清空, 只留群和来源以便各端定位; 安静路由, 不会再响铃。 */
export function tombstoneOf(ev: Envelope, mode: DeleteMode, now: number): Envelope {
  const t = {
    id: ev.id,
    seq: 0,
    ts: ev.ts,
    kind: "event",
    source: ev.source,
    priority: ev.priority,
    data: { title: mode === "recall" ? TEXT_RECALLED : TEXT_DELETED, severity: "normal" },
    route: { action: "silent", channels: ["ws"], reason: mode === "recall" ? TEXT_RECALLED : TEXT_DELETED },
    deleted: { mode, at: now, seq: ev.deleted?.seq ?? ev.seq },
  } as Envelope;
  if (ev.channel) t.channel = ev.channel;
  if (ev.cid) t.cid = ev.cid;
  if (ev.by) t.by = ev.by;
  return t;
}

const SEND_SCOPE = "messages:send";

// 作者: 人按发送者账号 (旧消息没有 by, 主人带 cid 的算自己的); Agent 按自己的来源
function isAuthor(core: Core, who: Principal, ev: Envelope): boolean {
  if (who.owner) return !!ev.cid && (!ev.by || ev.by === authorOf(core, who));
  if (who.member) return !!ev.by && ev.by === who.member.user.id;
  return who.key.scopes.includes(SEND_SCOPE) && ev.source.id === originOf(core, who).source.id;
}

function mayRecall(core: Core, who: Principal, ev: Envelope, now: number): boolean {
  if (who.owner || mayAdmin(core, who, ev)) return true;
  if (!isAuthor(core, who, ev)) return false;
  // Agent 撤回自己的不限时; 真人 (子号) 限 2 分钟
  const human = "member" in who && !!who.member;
  return !human || now - ev.ts <= RECALL_WINDOW_MS;
}

function mayAdmin(core: Core, who: Principal, ev: Envelope): boolean {
  if (who.owner) return true;
  const grp = groupOf(ev);
  return !!who.member && !!grp && rank(roleIn(core, who, grp) ?? "member") >= rank("admin");
}

// 删除: 主人任何消息; 群管理员本群; Agent 自己所在的群
function mayDelete(core: Core, who: Principal, ev: Envelope): boolean {
  if (who.owner) return true;
  const grp = groupOf(ev);
  if (who.member) return !!grp && rank(roleIn(core, who, grp) ?? "member") >= rank("admin");
  return who.key.scopes.includes(SEND_SCOPE) && !!ev.channel && ev.channel === who.key.channels[0];
}

// 真人撤回自己的消息限 2 分钟 (规范 message-pages §8); 管理员与 Agent 不限
export const RECALL_WINDOW_MS = 2 * 60_000;

/** 撤回 (#139): 真人作者 2 分钟内, 主人 / 群管理员 / Agent 自己的随时; 删除: 主人删任何消息, 群管理员删本群的, Agent 删自己所在群的。墓碑换新 seq, 断线设备补拉时也能收到。 */
export async function removeMessage(core: Core, who: Principal, seq: number, mode: DeleteMode, now = Date.now()): Promise<Envelope> {
  const ev = core.store.bySeq(seq);
  if (!ev) throw new ApiFail(404, CODE_NOT_FOUND, ERR_NO_RESOURCE);
  if (ev.deleted?.mode === mode || ev.deleted?.mode === "delete") return ev;
  if (ev.kind === "metric" || ev.kind === "task") throw new ApiFail(400, CODE_BAD_REQUEST, "指标和任务不能撤回或删除");
  if (mode === "recall" && !ev.deleted && !mayRecall(core, who, ev, now)) throw new ApiFail(403, CODE_FORBIDDEN, "只能撤回自己 2 分钟内发的消息, 管理员不限");
  if (mode === "delete" && !mayDelete(core, who, ev)) throw new ApiFail(403, CODE_FORBIDDEN, "只有群主, 管理员和本群的 Agent 能删除消息");
  const saved = core.store.put(tombstoneOf(ev, mode, now));
  await core.files.track(ev, saved);
  core.store.pruneTombstones(now - TOMBSTONE_KEEP_MS);
  if (core.chats.removeFavorite(saved.deleted?.seq ?? seq)) {
    core.sockets.toV1Clients({ t: "chat_sync", topic: "favorites" } satisfies ChatSyncFrame);
  }
  core.sockets.deliverEv(saved);
  return saved;
}

async function deleteBySeq(c: ReqCtx): Promise<Response> {
  const seq = Number.parseInt(decodeURIComponent(c.params[0] ?? ""), 10);
  if (!Number.isFinite(seq) || seq <= 0) return fail(400, "seq 不合法");
  const mode = c.url.searchParams.get(QUERY_MODE) ?? "delete";
  if (!(DELETE_MODES as readonly string[]).includes(mode)) return fail(400, "mode 只能是 recall 或 delete");
  return json(await removeMessage(c.core, c.who, seq, mode as DeleteMode));
}

export const RECALL_ROUTES: Route[] = [route(DELETE, PATH_EVENT_BY_SEQ, ROOM, deleteBySeq)];
