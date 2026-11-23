import {
  DELETE_MODES,
  PATH_EVENT_BY_SEQ,
  QUERY_MODE,
  RECALL_WINDOW_MS,
  TOMBSTONE_KEEP_MS,
  type ChatSyncFrame,
  type DeleteMode,
  type Envelope,
} from "@hx-aioa/protocol";
import { CODE_BAD_REQUEST, CODE_NOT_FOUND, DELETE, ERR_NO_RESOURCE } from "./constants";
import { type Core, OWNER, type ReqCtx, type Route, route } from "./core";
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
  return t;
}

/** 撤回 (2 分钟内, 只限客户端发出的聊天消息) 或删除 (任何消息); 墓碑换新 seq, 断线设备补拉时也能收到。 */
export function removeMessage(core: Core, seq: number, mode: DeleteMode, now = Date.now()): Envelope {
  const ev = core.store.bySeq(seq);
  if (!ev) throw new ApiFail(404, CODE_NOT_FOUND, ERR_NO_RESOURCE);
  if (ev.deleted?.mode === mode || ev.deleted?.mode === "delete") return ev;
  if (ev.kind === "metric" || ev.kind === "task") throw new ApiFail(400, CODE_BAD_REQUEST, "指标和任务不能撤回或删除");
  if (mode === "recall" && !ev.deleted && (!ev.cid || now - ev.ts > RECALL_WINDOW_MS)) {
    throw new ApiFail(400, CODE_BAD_REQUEST, "只能撤回 2 分钟内自己发出的消息");
  }
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
  return json(removeMessage(c.core, seq, mode as DeleteMode));
}

export const RECALL_ROUTES: Route[] = [route(DELETE, PATH_EVENT_BY_SEQ, OWNER, deleteBySeq)];
