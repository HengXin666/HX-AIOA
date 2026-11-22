import type { KeyInfo, Scope } from "@hx-aioa/protocol";
import type { AgentService } from "./agents";
import type { Config } from "./config";
import type { Env } from "./env";
import type { MetricRouter } from "./metrics";
import type { Pipeline } from "./pipeline";
import type { Registry } from "./registry";
import type { Sockets } from "./sockets";
import type { Spaces } from "./spaces";
import type { EventStore } from "./store";

// AUTH_TOKEN 视为母号的全权限凭证; 接入 key 只写不读, 按 scope 授权
export type Principal = { owner: true } | { owner: false; key: KeyInfo };

export type Core = {
  env: Env;
  store: EventStore;
  registry: Registry;
  config: Config;
  pipeline: Pipeline;
  agents: AgentService;
  metrics: MetricRouter;
  sockets: Sockets;
  spaces: Spaces;
};

export type ReqCtx = { req: Request; url: URL; params: string[]; who: Principal; core: Core };
export type Need = "owner" | Scope;
export type Handler = (c: ReqCtx) => Promise<Response> | Response;
export type Route = { method: string; re: RegExp; need: Need; handler: Handler };
export const OWNER: Need = "owner";

// 路径常量里的 {x} 段变成捕获组
export function route(method: string, path: string, need: Need, handler: Handler): Route {
  const re = new RegExp(`^${path.replace(/\{[^}]+\}/g, "([^/]+)")}$`);
  return { method, re, need, handler };
}

export function allowed(who: Principal, need: Need): boolean {
  if (who.owner) return true;
  return need !== OWNER && who.key.scopes.includes(need as Scope);
}

export const keyIdOf = (who: Principal) => (who.owner ? null : who.key.id);
