import type { Envelope, UserPublic } from "@hx-aioa/protocol";
import { ChatStore } from "../src/chat-store";
import { PROTO_V1 } from "../src/constants";
import type { Core, Principal, ReqCtx, Route } from "../src/core";
import { Pipeline } from "../src/pipeline";
import { ownerSees } from "../src/room-access";
import { RoomStore } from "../src/rooms";
import { type Attachment, Sockets } from "../src/sockets";
import { EventStore, groupOf } from "../src/store";
import { memSql } from "./sql";

// 群聊相关测试的公共夹具: 真的 ChatStore / RoomStore / EventStore / Sockets, 账号与连接是假的
export const OWNER_UID = "u_owner";
export const BASE = "https://hub.test";
export type FakeWs = WebSocket & { frames: Record<string, unknown>[] };

export const user = (id: string, display = id): UserPublic => ({ id, name: id, display, role: id === OWNER_UID ? "owner" : "member", status: "active", created: 1 });

export function chatCore(ids: string[] = []) {
  const sql = memSql();
  const store = new EventStore(sql, (fn) => fn());
  const chats = new ChatStore(sql);
  const rooms = new RoomStore(sql);
  const people = new Map([OWNER_UID, ...ids].map((id) => [id, user(id)]));
  const wss: FakeWs[] = [];
  const core = {} as Core;
  const sockets = new Sockets(
    () => wss,
    (ev: Envelope) => new Set(rooms.members(groupOf(ev) ?? "").map((m) => m.member)),
    (grp) => !ownerSees(core, grp),
  );
  const pipeline = new Pipeline({} as never, {} as never, store, { rules: async () => [] } as never, {} as never, sockets, {} as never);
  Object.assign(core, {
    store,
    chats,
    rooms,
    sockets,
    pipeline,
    presence: { sent() {}, polled() {} },
    users: { get: (id: string) => people.get(id) ?? null, find: (id: string) => people.get(id) ?? null, ownerId: () => OWNER_UID },
  });
  const connect = (att: Partial<Attachment>): FakeWs => {
    const a = { device: `d${wss.length}`, proto: PROTO_V1, role: "client", ...att } as Attachment;
    const ws = { frames: [], deserializeAttachment: () => a, send(t: string) { ws.frames.push(JSON.parse(t)); } } as unknown as FakeWs;
    wss.push(ws);
    sockets.reset();
    return ws;
  };
  return { core, sql, store, chats, rooms, people, connect };
}

export const ownerWho: Principal = { owner: true };
export const memberWho = (id: string): Principal => ({ owner: false, key: { id: `member:${id}`, scopes: [], channels: [] } as never, member: { user: user(id), session: "" } });

export async function call(core: Core, routes: Route[], who: Principal, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const url = new URL(BASE + path);
  const r = routes.find((x) => x.method === method && x.re.test(url.pathname));
  if (!r) throw new Error(`没有路由 ${method} ${path}`);
  const params = r.re.exec(url.pathname)!.slice(1);
  const req = new Request(url, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const res = await r.handler({ req, url, params, who, core } as ReqCtx);
  const text = await res.text();
  return { status: res.status, etag: res.headers.get("ETag"), body: (text ? JSON.parse(text) : null) as Record<string, unknown> };
}

export const said = (store: EventStore, channel: string, text: string, src = "张三") =>
  store.put({ id: `m_${text}`, seq: 0, ts: 1, kind: "event", source: { id: `user:${src}`, name: src }, channel, priority: "happening", data: { title: text, severity: "normal" } } as Envelope);
