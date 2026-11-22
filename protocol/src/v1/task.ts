import {
  MAX_ID_LENGTH,
  MAX_SUMMARY_LENGTH,
  MAX_TITLE_LENGTH,
  PRIORITIES,
  TASK_OPS,
  USER_ACTION_KINDS,
  type Priority,
  type TaskOpKind,
  type TaskState,
  type UserActionKind,
} from "./constants";

export type PromptOption = { id: string; label: string; style?: "primary" | "danger" };
export type Prompt = {
  id: string;
  question: string;
  options: PromptOption[];
  allowText?: boolean;
  danger?: boolean;
  expires?: number;
  expired?: boolean;
};

export type TaskSnapshot = {
  id: string;
  agent: string;
  title: string;
  summary?: string;
  subject?: string;
  state: TaskState;
  progress?: number;
  step?: string;
  prompt?: Prompt;
  result?: string;
  error?: string;
  created: number;
  updated: number;
};

export type PromptInput = {
  question: string;
  options?: PromptOption[];
  allowText?: boolean;
  danger?: boolean;
  timeoutSec?: number;
};

// Agent 上报的任务操作, WS 帧与 HTTP 共用
export type TaskOp = {
  taskId: string;
  op: TaskOpKind;
  agent?: string;
  title?: string;
  summary?: string;
  subject?: string;
  priority?: Priority;
  progress?: number;
  step?: string;
  text?: string;
  prompt?: PromptInput;
  result?: string;
  error?: string;
};

// 用户对任务的动作, aid 由客户端生成, 用于幂等
export type UserActionInput = {
  aid: string;
  taskId: string;
  kind: UserActionKind;
  option?: string;
  text?: string;
  confirm?: boolean;
};
export type UserAction = UserActionInput & { ts: number; user: string; promptId?: string; timeout?: boolean };

export type TaskLogEntry = {
  ts: number;
  role: "agent" | "user" | "system";
  kind: string;
  text?: string;
  data?: unknown;
};

export type AgentInfo = { id: string; name: string; icon?: string; desc?: string };
export type AgentStatus = AgentInfo & { online: boolean; lastSeen: number; mode: "ws" | "http" };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const idOk = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= MAX_ID_LENGTH;
const textOk = (v: unknown, max: number) => v === undefined || (typeof v === "string" && v.length <= max);

function parseOptions(v: unknown): PromptOption[] | null {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > 8) return null;
  const out: PromptOption[] = [];
  for (const o of v) {
    if (!isObj(o) || !idOk(o.id) || typeof o.label !== "string") return null;
    const item: PromptOption = { id: o.id, label: o.label };
    if (o.style === "primary" || o.style === "danger") item.style = o.style;
    out.push(item);
  }
  return out;
}

export function parseTaskOp(raw: unknown): TaskOp | string {
  if (!isObj(raw)) return "任务操作必须是对象";
  if (!idOk(raw.taskId)) return "需要 taskId";
  if (typeof raw.op !== "string" || !(TASK_OPS as readonly string[]).includes(raw.op)) return "op 取值错误";
  for (const k of ["title", "step"]) if (!textOk(raw[k], MAX_TITLE_LENGTH)) return `${k} 过长`;
  for (const k of ["summary", "text", "result", "error"]) if (!textOk(raw[k], MAX_SUMMARY_LENGTH)) return `${k} 过长`;
  if (raw.op === "create" && typeof raw.title !== "string") return "create 需要 title";
  const op: TaskOp = { taskId: raw.taskId, op: raw.op as TaskOpKind };
  for (const k of ["agent", "title", "summary", "subject", "step", "text", "result", "error"] as const) {
    const v = raw[k];
    if (typeof v === "string" && v) op[k] = v;
  }
  if (typeof raw.progress === "number") op.progress = Math.max(0, Math.min(1, raw.progress));
  if (typeof raw.priority === "string" && (PRIORITIES as readonly string[]).includes(raw.priority)) {
    op.priority = raw.priority as Priority;
  }
  if (raw.op === "wait") {
    const p = raw.prompt;
    if (!isObj(p) || typeof p.question !== "string" || !p.question) return "wait 需要 prompt.question";
    const options = parseOptions(p.options);
    if (!options) return "prompt.options 格式错误 (最多 8 个, 需要 id 与 label)";
    const prompt: PromptInput = { question: p.question, options };
    if (p.allowText === true) prompt.allowText = true;
    if (p.danger === true) prompt.danger = true;
    if (typeof p.timeoutSec === "number" && p.timeoutSec > 0) prompt.timeoutSec = Math.floor(p.timeoutSec);
    op.prompt = prompt;
  }
  return op;
}

export function parseUserAction(raw: unknown): UserActionInput | string {
  if (!isObj(raw)) return "动作必须是对象";
  if (!idOk(raw.aid)) return "需要 aid (幂等 id)";
  if (!idOk(raw.taskId)) return "需要 taskId";
  if (typeof raw.kind !== "string" || !(USER_ACTION_KINDS as readonly string[]).includes(raw.kind)) return "kind 取值错误";
  if (!textOk(raw.text, MAX_SUMMARY_LENGTH)) return "text 过长";
  const a: UserActionInput = { aid: raw.aid, taskId: raw.taskId, kind: raw.kind as UserActionKind };
  if (typeof raw.option === "string" && raw.option) a.option = raw.option;
  if (typeof raw.text === "string" && raw.text) a.text = raw.text;
  if (raw.confirm === true) a.confirm = true;
  return a;
}

export function parseAgentInfo(raw: unknown): AgentInfo | string {
  if (!isObj(raw) || !idOk(raw.id)) return "agent 需要 id";
  const info: AgentInfo = { id: raw.id, name: typeof raw.name === "string" && raw.name ? raw.name : raw.id };
  if (typeof raw.icon === "string") info.icon = raw.icon;
  if (typeof raw.desc === "string") info.desc = raw.desc;
  return info;
}
