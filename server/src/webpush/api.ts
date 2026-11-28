import { isWebDevice, parseWebPushSub, PATH_DEVICE_WEBPUSH, PATH_WEBPUSH_KEY, WEB_DEVICE_PREFIX, type WebPushKey } from "@hx-aioa/protocol";
import { CODE_FORBIDDEN, CODE_NOT_CONFIGURED, DELETE, ERR_FORBIDDEN, GET, PUT } from "../constants";
import { type ReqCtx, type Route, ROOM, route } from "../core";
import { fail, json, pathParam, readJson } from "../http";
import { WebPush } from "./service";

const ERR_DEVICE = `设备 id 必须以 ${WEB_DEVICE_PREFIX} 开头, 只含字母数字 _ -`;
const forbidden = () => fail(403, ERR_FORBIDDEN, CODE_FORBIDDEN);

// 只有登录的人 (主人或子号) 有自己的设备; 纯接入 key 不行
function uidOf(c: ReqCtx): string | null {
  const w = c.who;
  if (w.owner) return w.user?.id ?? c.core.users.ownerId();
  return w.member ? w.member.user.id : null;
}

function key(c: ReqCtx): Response {
  if (!uidOf(c)) return forbidden();
  return json({ key: c.core.webpush.publicKey() } satisfies WebPushKey);
}

async function subscribe(c: ReqCtx): Promise<Response> {
  const uid = uidOf(c);
  if (!uid) return forbidden();
  const device = pathParam(c.params, 0);
  if (!isWebDevice(device)) return fail(400, ERR_DEVICE);
  const sub = parseWebPushSub(await readJson(c.req));
  if (typeof sub === "string") return fail(400, sub);
  if (!WebPush.configured(c.core.env)) return fail(503, "服务端没有配置 VAPID, Web Push 不可用", CODE_NOT_CONFIGURED);
  return json({ ok: true, changed: c.core.webpush.store.put(uid, device, sub) });
}

function unsubscribe(c: ReqCtx): Response {
  const uid = uidOf(c);
  if (!uid) return forbidden();
  const device = pathParam(c.params, 0);
  if (!isWebDevice(device)) return fail(400, ERR_DEVICE);
  return json({ ok: true, changed: c.core.webpush.store.remove(uid, device) });
}

export const WEBPUSH_ROUTES: Route[] = [route(GET, PATH_WEBPUSH_KEY, ROOM, key), route(PUT, PATH_DEVICE_WEBPUSH, ROOM, subscribe), route(DELETE, PATH_DEVICE_WEBPUSH, ROOM, unsubscribe)];
