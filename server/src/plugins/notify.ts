import type { PDataSyncFrame, PluginChange, PluginUpdateFrame } from "@hx-aioa/protocol";
import { PROTO_V1 } from "../constants";
import type { Core } from "../core";
import { attOf, sendFrame } from "../sockets";
import { privatePlugin } from "./private";

/**
 * 插件变化推给界面连接: uid 为空发给所有人 (白名单变化), 否则只发给该账号; 安卓后台连接不发。
 * keyId 给了就再推给该插件 Agent 的长连, 带 guide 让它立即重拉专属指令。
 */
export function pushPlugin(core: Core, id: string, change: PluginChange, opts: { uid?: string; version?: string; keyId?: string } = {}): void {
  const frame: PluginUpdateFrame = { t: "plugin_update", id, change, ...(opts.version ? { version: opts.version } : {}) };
  // 私有插件的白名单变化只推给主人
  toAccount(core, opts.uid ?? (privatePlugin(core, id) ? core.users.ownerId() : undefined), frame);
  if (!opts.keyId) return;
  const guide: PluginUpdateFrame = { ...frame, guide: opts.version ?? change };
  for (const ws of core.sockets.chatSockets(opts.keyId)) sendFrame(ws, guide);
}

/** 界面连接: uid 为空发给所有人, 主人的 uid 发给主人的连接, 否则只发给该子号; 安卓后台连接不发。 */
export function toAccount(core: Core, uid: string | undefined, frame: unknown): void {
  const owner = core.users.ownerId();
  for (const ws of core.sockets.clients()) {
    const a = attOf(ws);
    if (a.proto !== PROTO_V1 || a.bg) continue;
    if (uid && (uid === owner ? a.member : a.uid !== uid)) continue;
    sendFrame(ws, frame);
  }
}

export function pushPData(core: Core, uid: string, plugin: string, coll: string, rev: number): void {
  toAccount(core, uid, { t: "pdata_sync", plugin, coll, rev } satisfies PDataSyncFrame);
}
