// 页面与连接持有方 (SharedWorker / 主标签 / 本页) 之间的消息; 两边都只认 op, 未知的忽略
export type LinkState = "idle" | "connecting" | "online" | "offline";
// 收到的帧只认 t, 具体字段由各 store 自己判断; 未知类型直接忽略 (向前兼容)
export type Frame = { t: string } & Record<string, unknown>;

export type ToHub =
  | { op: "hello"; id: string; visible: boolean; device: string; base: string; watch: string[]; token?: Token }
  | { op: "token"; token: Token | null }
  | { op: "write"; frame: Frame }
  | { op: "seen"; seq: number }
  | { op: "visible"; visible: boolean }
  | { op: "bye" };

export type FromHub =
  | { op: "frame"; f: Frame }
  | { op: "state"; s: LinkState }
  | { op: "need-token" }
  | { op: "kicked" }
  | { op: "who" };

// exp: 访问令牌到期时间 (ms); 持有方只在握手时用一次, 快到期就向页面要新的
export type Token = { value: string; exp: number };
