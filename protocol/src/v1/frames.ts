import type { Priority } from "./constants";
import type { Envelope } from "./event";
import type { Space } from "./space";
import {
  parseAgentInfo,
  parseTaskOp,
  parseUserAction,
  type AgentInfo,
  type TaskOp,
  type TaskSnapshot,
  type UserAction,
  type UserActionInput,
} from "./task";
import type { UserPublic } from "./api";

// v1 流 (/api/v1/stream) 在旧帧之外新增的帧
export type ActFrame = { t: "act" } & UserActionInput;
export type OverviewRequestFrame = { t: "overview" };
export type TaskOpFrame = { t: "task" } & TaskOp;
export type AgentHelloFrame = { t: "agent_hello"; agent: AgentInfo };
export type ActAckFrame = { t: "act_ack"; aid: string };
export type StreamClientFrame = ActFrame | OverviewRequestFrame | TaskOpFrame | AgentHelloFrame | ActAckFrame;

export type EvFrame = { t: "ev"; ev: Envelope };
export type TaskFrame = { t: "task"; task: TaskSnapshot };
export type ActDeliverFrame = { t: "act"; action: UserAction };
export type ActOkFrame = { t: "act_ok"; aid: string; state: "queued" | "delivered" | "duplicate" };
export type SpaceUpdateFrame = { t: "space_update"; id: string; space?: Space; deleted?: boolean };
export type SettingsFrame = { t: "settings"; settings: Record<string, unknown> };
export type ProbeConfig = {
  idleSampleMs?: number;
  liveIntervalMs?: number;
  alerts?: Record<string, number>;
};
export type ProbeConfigFrame = { t: "probe_config"; subject: string; config: ProbeConfig };

export type OverviewItem = { ev: Envelope; count: number; ids: string[] };
export type Overview = { layers: Record<Priority, OverviewItem[]>; tasks: TaskSnapshot[]; generatedAt: number };
export type OverviewFrame = { t: "overview"; overview: Overview };

export type StreamWelcome = {
  t: "welcome";
  head: number;
  v: number;
  now: number;
  user?: UserPublic;
  session?: string;
  role: "client" | "agent" | "probe";
};

export type StreamServerFrame =
  | EvFrame
  | TaskFrame
  | ActDeliverFrame
  | ActOkFrame
  | SpaceUpdateFrame
  | SettingsFrame
  | ProbeConfigFrame
  | OverviewFrame
  | StreamWelcome;

export function parseStreamFrame(data: Record<string, unknown>): StreamClientFrame | string | null {
  switch (data.t) {
    case "act": {
      const a = parseUserAction(data);
      return typeof a === "string" ? a : { t: "act", ...a };
    }
    case "overview":
      return { t: "overview" };
    case "task": {
      const op = parseTaskOp(data);
      return typeof op === "string" ? op : { t: "task", ...op };
    }
    case "agent_hello": {
      const info = parseAgentInfo(data.agent);
      return typeof info === "string" ? info : { t: "agent_hello", agent: info };
    }
    case "act_ack":
      return typeof data.aid === "string" ? { t: "act_ack", aid: data.aid } : "act_ack 需要 aid";
    default:
      return null;
  }
}
