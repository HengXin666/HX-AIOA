// Agent GUI 类型: 契约部分来自 protocol (agent-gui.ts), 这里只补直连帧的本地形状与渲染用的 ACP 子集
import type { AgCard, AgDevice, AgHello, AgHost, AgIndexItem, AgInboxResponse, AgInstance, AgPairResponse, AgPermOption, AgRisk, AgRoute, AgRouteKind, AgSessionInfo, AgSessionState, AgSettings, AgStats, AgWatchPush } from "@hx-aioa/protocol";

export type RouteKind = AgRouteKind;
export type Route = AgRoute;
export type Instance = AgInstance;
export type SessionState = AgSessionState;
// 契约外补的两项: 探针若在 SessionInfo 里带分支与 ACP 配置选项, 顶栏与模型面板直接用
export type SessionInfo = AgSessionInfo & { branch?: string; configOptions?: unknown };
export type WatchPush = AgWatchPush;
export type Settings = AgSettings;
export type Device = AgDevice;
export type Risk = AgRisk;
export type PermOption = AgPermOption;
export type Card = AgCard;
export type Stats = Omit<AgStats, "t" | "sid">;
export type HubSession = AgIndexItem;
export type HubHost = AgHost;
export type PairResult = AgPairResponse;
export type InboxResult = AgInboxResponse;
export type Hello = AgHello;

// 直连帧
export type JsonRpc = {
  jsonrpc?: "2.0";
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  error?: { code: number; message: string; data?: unknown };
};
export type LogItem = { seq: number; m: JsonRpc; at?: number };
export type ProbeFrame =
  | { t: "challenge"; nonce: string; host: string; pub: JsonWebKey }
  | { t: "ready"; device: string; host: string; sessions: SessionInfo[]; instances: Instance[]; settings: Settings }
  | { t: "error"; code: string; msg: string }
  | { t: "acp"; sid: string; seq: number; m: JsonRpc; at?: number }
  | { t: "window"; sid: string; from: number; to: number; more: boolean; items: LogItem[] }
  | { t: "perm_req"; sid: string; rid: string; card: Card }
  | { t: "perm_done"; sid: string; rid: string; by: string; option?: string }
  | { t: "session"; info: SessionInfo }
  | ({ t: "stats"; sid: string } & Stats)
  | { t: "hx_res"; id: number; ok: boolean; r?: unknown; err?: string };


// ACP 子集: 只声明渲染用到的字段, 其余原样保留
export type ContentBlock = { type: string; text?: string; uri?: string; name?: string; mimeType?: string; data?: string; resource?: { uri?: string; text?: string } };
export type ToolContent =
  | { type: "content"; content: ContentBlock }
  | { type: "diff"; path: string; oldText?: string | null; newText: string }
  | { type: "terminal"; terminalId: string };
export type ToolLocation = { path: string; line?: number };
export type PlanEntry = { content: string; priority?: string; status: "pending" | "in_progress" | "completed" | string };
export type SlashCommand = { name: string; description?: string; input?: { hint?: string } | null };
export type Mode = { id: string; name: string; description?: string };
export type ModeState = { currentModeId: string; availableModes: Mode[] };
export type Model = { modelId: string; name: string; description?: string };
export type ModelState = { currentModelId: string; availableModels: Model[] };
export type ConfigValue = { value: string; name: string; description?: string };
export type ConfigOption = {
  id: string;
  name: string;
  description?: string;
  category?: string;
  type?: string;
  currentValue: string;
  options: (ConfigValue | { group: string; name: string; options: ConfigValue[] })[];
};
export type Usage = { used: number; size: number; cost?: { amount: number; currency: string } | null };
