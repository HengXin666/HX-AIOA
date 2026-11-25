import type { Migrator } from "./files/migrate";
import type { TranslateStore } from "./translate/store";
import type { FileStore } from "./files/store";
import type { GhService } from "./gh/service";
import type { MailStore } from "./mail/store";
import type { Market } from "./plugins/market";
import type { PluginStore } from "./plugins/store";
import type { TodoStore } from "./plugins/todos";
import type { KeyInfo, Scope, UserPublic } from "@hx-aioa/protocol";
import type { AgentService } from "./agents";
import type { ChatStore } from "./chat-store";
import type { Config } from "./config";
import type { Env } from "./env";
import type { GithubService } from "./github/service";
import type { MetricRouter } from "./metrics";
import type { Pipeline } from "./pipeline";
import type { Presence } from "./presence";
import type { Registry } from "./registry";
import type { Sockets } from "./sockets";
import type { Spaces } from "./spaces";
import type { Terminals } from "./terminal";
import type { RoomStore } from "./rooms";
import type { EventStore } from "./store";

// AUTH_TOKEN 视为母号的全权限凭证; 接入 key 只写不读, 按 scope 授权
// 账号登录的设备在自己的 DO 里同样视为 owner, user / session 用于审计与踢下线
// 子号 (member) 只能进自己所在的多人群: 给它一把没有任何 scope 的虚拟 key, 其余接口自然 403
export type Member = { user: UserPublic; session: string };
export type Principal = { owner: true; user?: UserPublic; session?: string } | { owner: false; key: KeyInfo; member?: Member };

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
  github: GithubService;
  chats: ChatStore;
  // 谁在监听 / 输入, 只在内存
  presence: Presence;
  rooms: RoomStore;
  files: FileStore;
  migrator: Migrator;
  plugins: PluginStore;
  mail: MailStore;
  // 译文缓存与每月计费字符
  tr: TranslateStore;
  todos: TodoStore;
  gh: GhService;
  market: Market;
  users: Users;
  terms: Terminals;
  // 账号密码复核 (终端票据用), 只有主 Hub 有账号目录
  checkPassword: (userId: string, password: string) => Promise<boolean>;
  // 本 DO 数据库当前大小 (字节)
  dbSize: () => number;
};

export type Users = { get: (id: string) => UserPublic | null; find: (ref: string) => UserPublic | null; ownerId: () => string };

export type ReqCtx = { req: Request; url: URL; params: string[]; who: Principal; core: Core };
// ROOM: 主人, 子号, key 都放行, 由处理函数按群身份再判
export type Need = "owner" | "room" | Scope;
export type Handler = (c: ReqCtx) => Promise<Response> | Response;
export type Route = { method: string; re: RegExp; need: Need; handler: Handler };
export const OWNER: Need = "owner";
export const ROOM: Need = "room";

// 路径常量里的 {x} 段变成捕获组
export function route(method: string, path: string, need: Need, handler: Handler): Route {
  const re = new RegExp(`^${path.replace(/\{[^}]+\}/g, "([^/]+)")}$`);
  return { method, re, need, handler };
}

export function allowed(who: Principal, need: Need): boolean {
  if (who.owner || need === ROOM) return true;
  return need !== OWNER && who.key.scopes.includes(need as Scope);
}

export const keyIdOf = (who: Principal) => (who.owner ? null : who.key.id);
