import { CAT_MODE, CAT_MODEL, CAT_THOUGHT } from "./constants";
import type { HostConn } from "./conn";
import type { View } from "./reduce";
import type { ConfigOption, ConfigValue, ModeState, ModelState, SessionInfo } from "./types";

// 权限模式 / 模型 / 思考深度: 优先用 ACP 配置选项, 没有再退到 modes / models (都按 Agent 公布的原样显示)
export type Choice = { value: string; name: string; description?: string };
export type Picker = { source: "config" | "legacy"; id: string; name: string; current: string; choices: Choice[] };

const flat = (o: ConfigOption): Choice[] => o.options.flatMap((x) => ("options" in x ? (x.options as ConfigValue[]) : [x as ConfigValue]));

function configs(view: View, info?: SessionInfo): ConfigOption[] {
  if (view.config.length) return view.config;
  // 探针把 session/new 回包的 configOptions 放在 caps 里
  const caps = (info?.caps ?? {}) as { configOptions?: unknown };
  const list = info?.configOptions ?? caps.configOptions;
  return Array.isArray(list) ? (list as ConfigOption[]) : [];
}

function fromConfig(view: View, info: SessionInfo | undefined, cat: string): Picker | null {
  const o = configs(view, info).find((c) => c.category === cat || (!c.category && c.id === cat));
  return o ? { source: "config", id: o.id, name: o.name, current: o.currentValue, choices: flat(o) } : null;
}

export function modePicker(view: View, info?: SessionInfo): Picker | null {
  const c = fromConfig(view, info, CAT_MODE);
  if (c) return c;
  const m = (view.modes?.availableModes.length ? view.modes : (info?.modes as ModeState | undefined)) ?? null;
  if (!m?.availableModes?.length) return null;
  const current = view.modes?.currentModeId || m.currentModeId;
  return { source: "legacy", id: "mode", name: "权限模式", current, choices: m.availableModes.map((x) => ({ value: x.id, name: x.name, description: x.description })) };
}

export function modelPicker(view: View, info?: SessionInfo): Picker | null {
  const c = fromConfig(view, info, CAT_MODEL);
  if (c) return c;
  const m = view.models ?? (info?.models as ModelState | undefined) ?? null;
  if (!m?.availableModels?.length) return null;
  return { source: "legacy", id: "model", name: "模型", current: m.currentModelId, choices: m.availableModels.map((x) => ({ value: x.modelId, name: x.name, description: x.description })) };
}

export const thoughtPicker = (view: View, info?: SessionInfo): Picker | null => fromConfig(view, info, CAT_THOUGHT);

export const nameOf = (p: Picker | null): string => p?.choices.find((c) => c.value === p.current)?.name ?? p?.current ?? "";

// 选中后发给 Agent; 结果以 Agent 回来的 update 为准, 不本地伪造
export function pick(conn: HostConn, sid: string, p: Picker, value: string): Promise<unknown> {
  if (p.source === "config") return conn.acpRequest(sid, "session/set_config_option", { configId: p.id, value });
  if (p.id === "mode") return conn.acpRequest(sid, "session/set_mode", { modeId: value });
  return conn.acpRequest(sid, "session/set_model", { modelId: value });
}
