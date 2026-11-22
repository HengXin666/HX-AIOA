import { type Integration, type IntegrationKind, type KeyInfo, PATH_INTEGRATIONS } from "@hx-aioa/protocol";
import { GET, OVERVIEW_SCAN } from "./constants";
import { type Core, OWNER, type Route, route } from "./core";
import { json } from "./http";

function kindOf(k: KeyInfo): IntegrationKind {
  if (k.scopes.includes("agent")) return "interactive";
  if (k.scopes.includes("probe")) return "probe";
  if (k.scopes.includes("messages:send") || k.scopes.includes("events:write")) return "push";
  return "other";
}

// 接入总览: key, 来源, 群里的 Agent, 交互 Agent 的在线状态合成一张表; 最近活跃取最近事件或心跳
export function integrations(core: Core): Integration[] {
  const sources = new Map(core.registry.sources().map((s) => [s.id, s]));
  const groupOf = new Map<string, string>();
  for (const m of core.chats.chats()) for (const a of m.agents ?? []) groupOf.set(a.keyId, m.channel);
  const lastBySource = new Map<string, number>();
  for (const ev of core.store.recent(OVERVIEW_SCAN)) lastBySource.set(ev.source.id, Math.max(lastBySource.get(ev.source.id) ?? 0, ev.ts));
  const agents = core.agents.byKey();
  return core.registry.keys().map((k) => {
    const src = k.sourceId ? sources.get(k.sourceId) : undefined;
    const group = groupOf.get(k.id) ?? src?.channel ?? k.channels[0];
    const live = (agents.get(k.id) ?? []).map((a) => ({ id: a.id, name: a.name, online: a.online, lastSeen: a.lastSeen }));
    const lastActive = Math.max(0, src ? (lastBySource.get(src.id) ?? 0) : 0, ...live.map((a) => a.lastSeen));
    return {
      keyId: k.id,
      name: k.name,
      prefix: k.prefix,
      kind: kindOf(k),
      scopes: k.scopes,
      ...(group ? { group } : {}),
      reads: k.scopes.includes("events:read") ? k.channels.filter((c) => c !== group) : [],
      ...(src ? { source: { id: src.id, name: src.name, type: src.type } } : {}),
      agents: live,
      lastActive,
      created: k.created,
    };
  });
}

export const INTEGRATION_ROUTES: Route[] = [route(GET, PATH_INTEGRATIONS, OWNER, (c) => json({ integrations: integrations(c.core) }))];
