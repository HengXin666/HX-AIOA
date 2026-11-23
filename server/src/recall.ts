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

// 删除: 主人任何消息; 群管理员本群; Agent 自己所在的群
function mayDelete(core: Core, who: Principal, ev: Envelope): boolean {
  if (who.owner) return true;
  const grp = groupOf(ev);
  if (who.member) return !!grp && rank(roleIn(core, who, grp) ?? "member") >= rank("admin");
  return who.key.scopes.includes(SEND_SCOPE) && !!ev.channel && ev.channel === who.key.channels[0];
}

/** 撤回: 作者随时可撤; 删除: 主人删任何消息, 群管理员删本群的, Agent 删自己所在群的。墓碑换新 seq, 断线设备补拉时也能收到。 */
export function removeMessage(core: Core, who: Principal, seq: number, mode: DeleteMode, now = Date.now()): Envelope {
  const ev = core.store.bySeq(seq);
  if (!ev) throw new ApiFail(404, CODE_NOT_FOUND, ERR_NO_RESOURCE);
  if (ev.deleted?.mode === mode || ev.deleted?.mode === "delete") return ev;
  if (ev.kind === "metric" || ev.kind === "task") throw new ApiFail(400, CODE_BAD_REQUEST, "指标和任务不能撤回或删除");
  if (mode === "recall" && !ev.deleted && !isAuthor(core, who, ev)) throw new ApiFail(403, CODE_FORBIDDEN, "只能撤回自己发的消息");
  if (mode === "delete" && !mayDelete(core, who, ev)) throw new ApiFail(403, CODE_FORBIDDEN, "只有群主, 管理员和本群的 Agent 能删除消息");
  const saved = core.store.put(tombstoneOf(ev, mode, now));
  core.store.pruneTombstones(now - TOMBSTONE_KEEP_MS);
  if (core.chats.removeFavorite(saved.deleted?.seq ?? seq)) {
    core.sockets.toV1Clients({ t: "chat_sync", topic: "favorites" } satisfies ChatSyncFrame);
  }
  core.sockets.deliverEv(saved);
  return saved;
}

function deleteBySeq(c: ReqCtx): Response {
  const seq = Number.parseInt(decodeURIComponent(c.params[0] ?? ""), 10);
  if (!Number.isFinite(seq) || seq <= 0) return fail(400, "seq 不合法");
  const mode = c.url.searchParams.get(QUERY_MODE) ?? "delete";
  if (!(DELETE_MODES as readonly string[]).includes(mode)) return fail(400, "mode 只能是 recall 或 delete");
  return json(removeMessage(c.core, c.who, seq, mode as DeleteMode));
}

export const RECALL_ROUTES: Route[] = [route(DELETE, PATH_EVENT_BY_SEQ, ROOM, deleteBySeq)];
