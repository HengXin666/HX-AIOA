// Agent GUI 运行时常量与文案

export const STORAGE_AG_PAIRS = "aioa.ag.pairs";
export const STORAGE_AG_HOST = "aioa.ag.host";
export const STORAGE_AG_MODE = "aioa.ag.mode";
export const STORAGE_AG_RIGHT = "aioa.ag.right";
export const STORAGE_AG_MOCK = "aioa.ag.mock";
export const STORAGE_AG_PREFS = "aioa.ag.prefs";
export const STORAGE_AG_DRAFTS = "aioa.ag.drafts";
export const STORAGE_AG_NOTIFY = "aioa.ag.notify";
// 每个会话最多暂存几条草稿; 本地诊断环形缓冲条数
export const DRAFT_MAX = 20;
export const DIAG_MAX = 500;
export const MENTION_MAX = 50;
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const KEY_DB = "aioa-agentgui";
export const KEY_STORE = "keys";
export const KEY_DEVICE = "device";

export const HELLO_TIMEOUT_MS = 3_000;
export const HANDSHAKE_TIMEOUT_MS = 6_000;
export const HX_TIMEOUT_MS = 15_000;
export const LIVENESS_TIMEOUT_MS = 3_000;
export const RETRY_MIN_MS = 1_000;
export const RETRY_MAX_MS = 30_000;
export const PAGE_TURNS = 20;
export const DIFF_PREVIEW_LINES = 40;
export const HOLD_MS = 1_000;
export const SLOW_RETRY_MS = 60_000;
// 打开页面时先拉的 inbox, 这么久内长连第一次连上就不再拉
export const INBOX_FRESH_MS = 10_000;
// 所有路线连续这么多轮都不通: 不再快速退避, 改为 "只能审批" 并慢速重试
export const ROUTE_FAIL_ROUNDS = 3;
// 建会话超过这么久还没回: 提示首次下载适配器
export const CREATE_SLOW_MS = 5_000;
export const CREATE_TIMEOUT_MS = 5 * 60_000;
export const ID_HEX = 16;

export const ROUTE_LABEL: Record<string, string> = { local: "本机", lan: "局域网", tunnel: "隧道", relay: "中继" };
export const ROUTE_ORDER = ["local", "lan", "tunnel"] as const;

export const TXT_NO_ROUTE = "需要在这台主机上或同一局域网打开, 隧道下一期";
export const TXT_APPROVE_ONLY = "此设备只能用审批模式 (局域网直连需隧道或 https, 本期未做)";
export const TXT_ROUTE_LOCAL_OFF = "不是这台主机本机, 本机地址用不了";
export const TXT_ROUTE_MIXED = "https 页面不能连 ws:// 局域网地址";
export const TXT_CREATE_SLOW = "首次启动正在下载适配器, 最长可能几分钟";
export const TXT_SCOPE_DENIED = "此主机开了 Agent 但密钥缺 probe:agent 权限";
export const TXT_RECONNECT = "重连中, 显示的可能不是最新";
export const TXT_UNPAIRED = "这台主机还没配对";
export const TXT_AUTH_FAIL = "主机不认这台设备, 请重新配对";
export const TXT_HOST_CHANGED = "主机身份与配对时不一致, 已停止连接";
export const TXT_NOT_READY = "未连上主机";
export const TXT_SEND_FAIL = "没有发出去";
export const TXT_ALLOW_ONCE = "允许一次";
export const TXT_ALLOW_ALWAYS = "总是允许";
export const TXT_REJECT = "拒绝";
export const TXT_REJECT_SAY = "拒绝并说明";
export const TXT_SEE_ALL = "看全部";
export const TXT_NEW_SESSION = "新会话";

export const STATE_LABEL: Record<string, string> = { starting: "启动中", running: "运行中", waiting: "等你", idle: "完成", error: "出错", closed: "已关闭" };
export const STATE_DOT: Record<string, "info" | "warning" | "success" | "destructive" | "muted"> = {
  starting: "info",
  running: "info",
  waiting: "warning",
  idle: "success",
  error: "destructive",
  closed: "muted",
};
export const RISK_LABEL: Record<string, string> = { low: "低风险", mid: "中风险", high: "高风险" };
export const KIND_LABEL: Record<string, string> = {
  read: "读取",
  edit: "编辑",
  delete: "删除",
  move: "移动",
  search: "搜索",
  execute: "运行",
  think: "思考",
  fetch: "联网",
  switch_mode: "切换模式",
  other: "工具",
};
// ACP PermissionOption.kind
export const OPT_ALLOW_ONCE = "allow_once";
export const OPT_ALLOW_ALWAYS = "allow_always";
export const OPT_REJECT_ONCE = "reject_once";
// ACP 配置选项分类
export const CAT_MODEL = "model";
export const CAT_MODE = "mode";
export const CAT_THOUGHT = "thought_level";
