export const API_V1 = "/api/v1";
export const STREAM_PATH = "/api/v1/stream";

export const KEY_PREFIX = "hxk_";
export const ACCESS_PREFIX = "hxa_";
export const REFRESH_PREFIX = "hxr_";
export const INVITE_PREFIX = "hxi_";

export const QUERY_KEY = "key";
export const QUERY_ROLE = "role";

export const PRIORITIES = ["need_me", "happening", "worth_reading"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const KINDS = ["metric", "event", "task", "report"] as const;
export type Kind = (typeof KINDS)[number];

export const SEVERITIES = ["critical", "warning", "normal", "info"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const EVENT_STATUSES = ["firing", "resolved", "ongoing"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const TASK_STATES = ["running", "waiting", "done", "failed", "cancelled"] as const;
export type TaskState = (typeof TASK_STATES)[number];

export const ROLES = ["owner", "admin", "member"] as const;
export type Role = (typeof ROLES)[number];

export const SCOPES = ["messages:send", "events:write", "spaces:write", "agent", "probe"] as const;
export type Scope = (typeof SCOPES)[number];

export const RULE_ACTIONS = ["alert", "push", "silent", "digest", "aggregate", "drop"] as const;
export type RuleAction = (typeof RULE_ACTIONS)[number];

export const DELIVERY_CHANNELS = ["ws", "mipush", "wxpusher", "next_open"] as const;
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];

export const USER_ACTION_KINDS = ["reply", "approve", "reject", "cancel", "ask"] as const;
export type UserActionKind = (typeof USER_ACTION_KINDS)[number];

export const TASK_OPS = ["create", "progress", "wait", "done", "fail", "say"] as const;
export type TaskOpKind = (typeof TASK_OPS)[number];

export const ITEM_TYPES = [
  "value",
  "sparkline",
  "line",
  "ring",
  "status_grid",
  "task_card",
  "list",
  "report",
  "button",
  "chat",
  "approval",
] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const STREAM_ROLES = ["client", "agent", "probe"] as const;
export type StreamRole = (typeof STREAM_ROLES)[number];

export const MAX_ID_LENGTH = 128;
export const MAX_TITLE_LENGTH = 300;
export const MAX_SUMMARY_LENGTH = 8000;
export const MAX_REPORT_LENGTH = 64_000;
export const MAX_ACTIONS = 6;
export const MAX_BATCH = 50;
export const MAX_TARGETS = 20;

// 关闭码: 4000 起为应用自定义
export const CLOSE_KICKED = 4001;
export const CLOSE_REVOKED = 4003;
