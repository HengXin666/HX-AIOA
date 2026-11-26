import { API_V1 } from "./constants";

// 握手三档 (docs/design/plugin-arch.md): 启动不等更新, 只有安全漏洞才拒绝
export const PATH_COMPAT = `${API_V1}/compat`;
// 客户端在流地址或 /compat 上带自己的协议大版本
export const QUERY_PROTOCOL = "pv";
// 支持窗口: 最近 2 个协议大版本
export const PROTOCOL_WINDOW = 2;
// 有安全漏洞必须拒绝的客户端协议版本; 只在这里加
export const PROTOCOL_BLOCKED: readonly number[] = [];
// 低于底线时被拒绝的 WebSocket 关闭码 / HTTP 状态
export const CLOSE_BLOCKED = 4426;
export const STATUS_BLOCKED = 426;

export const COMPAT_LEVELS = ["ok", "update", "floor", "blocked"] as const;
export type CompatLevel = (typeof COMPAT_LEVELS)[number];
// ok 兼容; update 建议更新; floor 低于支持窗口, 新功能灰掉; blocked 有安全漏洞, 拒绝
export type Compat = { level: CompatLevel; server: number; min: number; msg?: string };

const MSG: Record<Exclude<CompatLevel, "ok">, string> = {
  update: "服务端已升级, 建议更新 App, 旧版照常能用",
  floor: "App 版本过旧, 已超出支持范围, 新功能不可用, 请更新",
  blocked: "这个版本有安全问题, 已停止服务, 请更新 App",
};

/** 支持窗口的下限: server 往前数 PROTOCOL_WINDOW 个大版本 (含自己)。 */
export const protocolMin = (server: number): number => Math.max(1, server - PROTOCOL_WINDOW + 1);

/** 按客户端声明的协议大版本给出档位; 没声明 (老客户端) 当作兼容。 */
export function compatOf(pv: number | undefined, server: number): Compat {
  const min = protocolMin(server);
  const base = { server, min };
  if (pv === undefined || !Number.isInteger(pv) || pv < 1) return { level: "ok", ...base };
  const level: CompatLevel = PROTOCOL_BLOCKED.includes(pv) ? "blocked" : pv < min ? "floor" : pv < server ? "update" : "ok";
  return level === "ok" ? { level, ...base } : { level, ...base, msg: MSG[level] };
}

/** 读查询参数里的协议版本; 不是正整数就当没给。 */
export function parseProtocol(raw: string | null): number | undefined {
  if (!raw || !/^\d{1,4}$/.test(raw)) return undefined;
  const n = Number(raw);
  return n >= 1 ? n : undefined;
}
