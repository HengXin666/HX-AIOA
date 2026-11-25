import type { Priority, Role, Scope } from "./constants";
import type { Rule, TimeWindow } from "./rule";
import type { Envelope, EventGroup, RouteInfo } from "./event";

export type UserStatus = "active" | "pending" | "disabled";
export type UserPublic = { id: string; name: string; display: string; role: Role; status: UserStatus; created: number };
export type DeviceSession = { id: string; name: string; platform: string; created: number; seen: number; current?: boolean };
export type DeviceInput = { name?: string; platform?: string };

export type TokenPair = {
  access: string;
  refresh: string;
  expiresIn: number;
  session: string;
  user: UserPublic;
};

export type SetupRequest = { code: string; name: string; password: string; display?: string; device?: DeviceInput };
export type LoginRequest = { name: string; password: string; device?: DeviceInput };
export type JoinRequest = { code: string; name: string; password: string; display?: string; device?: DeviceInput };
export type JoinResult = TokenPair | { pending: true; user: UserPublic };

export type Me = { user: UserPublic; groups: GroupInfo[]; devices: DeviceSession[] };

export type InviteRequest = { role?: Exclude<Role, "owner">; groups?: string[]; ttlHours?: number; needsApproval?: boolean };
export type InviteInfo = {
  id: string;
  role: Role;
  groups: string[];
  expires: number;
  needsApproval: boolean;
  created: number;
  createdBy: string;
  usedBy?: string;
};
export type InviteCreated = InviteInfo & { code: string };

export type GroupInfo = { id: string; name: string; title: string; members: string[] };

export type ChannelInfo = { name: string; title: string; owner: string; readers: string[]; created: number };
export type SubscriptionInfo = {
  id: string;
  channel: string;
  target: string;
  minPriority?: Priority;
  mute?: TimeWindow;
  created: number;
};

export type KeyRequest = {
  name: string;
  scopes: Scope[];
  channels?: string[];
  ratePerMin?: number;
  sourceId?: string;
  subject?: string;
};
export type KeyInfo = {
  id: string;
  userId: string;
  name: string;
  prefix: string;
  scopes: Scope[];
  channels: string[];
  ratePerMin: number;
  sourceId?: string;
  subject?: string;
  created: number;
  // 过期时间 (毫秒), 到点后这把 key 当不存在; ext 表示外部接入密钥 (只碰 channels[0] 的待办)
  expires?: number;
  ext?: "read" | "write";
  used?: number;
};
export type KeyCreated = KeyInfo & { key: string; webhookSecret: string; webhookUrls: Record<string, string> };

export type JsonMapping = Record<string, string>;
export type SourceInfo = {
  id: string;
  userId: string;
  name: string;
  icon?: string;
  type: string;
  subject?: string;
  channel?: string;
  priority?: Priority;
  mapping?: JsonMapping;
  rules?: Rule[];
  callbackUrl?: string;
  keyId?: string;
  created: number;
};
export type SourceCreated = SourceInfo & { key?: KeyCreated };

export type IngestResult = { id: string; delivered: number; channel?: string };
export type ProbeCreated = { subject: string; key: string; install: string };
export type AuditEntry = { id: number; ts: number; actor: string; action: string; target: string; detail?: string };

export type EventsPage = { events: Envelope[]; head: number };
export type EventGroupsResult = { groups: EventGroup[] };
export type MetricLatest = { ts: number; values: Record<string, number>; units?: Record<string, string> };
export type ActResult = { aid: string; state: "queued" | "delivered" | "duplicate" };
export type RuleTestResult = { route: RouteInfo };
export type Settings = { tz?: string; quiet?: TimeWindow; wxpusherUid?: string } & Record<string, unknown>;
export type ApiError = { error: string; code: string; errors?: string[] };

// 接入总览: 每把 key 一行。push = 定时任务等单向推送的消息源; interactive = Codex 这类可双向交互的 Agent
export type IntegrationKind = "push" | "interactive" | "probe" | "other";
export type Integration = {
  keyId: string;
  name: string;
  prefix: string;
  kind: IntegrationKind;
  scopes: Scope[];
  group?: string;
  reads: string[];
  source?: { id: string; name: string; type: string };
  agents: { id: string; name: string; online: boolean; lastSeen: number }[];
  lastActive: number;
  created: number;
};
