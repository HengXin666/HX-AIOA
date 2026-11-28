// 探针 Agent GUI (#126) 的常量, 契约见 docs/design/agent-gui-impl.md
export const AGENT_V = 1;
export const AGENT_NAME = "hx-aioa-agent";
export const CLIENT_INFO = { name: "hx-aioa-probe", title: "HX-AIOA", version: "1" };
export const DEFAULT_LISTEN = "127.0.0.1:7841";
export const HOME_PARTS = [".config", "hx-aioa", "agent"];
export const SESSIONS_DIR = "sessions";

export const BATCH_MS = 16;
export const WINDOW_TURNS = 3;
export const WINDOW_BYTES = 256 * 1024;
export const SINCE_MAX_BYTES = 1024 * 1024;
export const CUT_CONTENT_BYTES = 2048;
export const CARD_TOOL_MAX = 2048;
export const FS_READ_MAX = 256 * 1024;
export const DIFF_MAX = 512 * 1024;
export const TREE_MAX = 2000;
export const RECENT_DIRS = 20;
export const INDEX_MAX = 50;
export const STATS_MS = 1000;
export const INDEX_MERGE_MS = 5000;
export const SAVE_MS = 1000;
export const HELLO_TIMEOUT_MS = 10_000;
// 首次 npx 下载适配器 (dsh 还要拉私有运行时) 可能要几分钟
export const INIT_TIMEOUT_MS = 300_000;
export const NEW_TIMEOUT_MS = 120_000;
export const KILL_GRACE_MS = 3000;
export const STDERR_TAIL = 4096;
export const TERM_OUTPUT_MAX = 1024 * 1024;
export const TERM_KEEP = 50;
export const WS_MAX_MSG = 8 * 1024 * 1024;
export const WS_PING_MS = 30_000;
export const WS_DEAD_MS = 75_000;
export const DEFLATE_MIN = 512;

export const BY_DESKTOP = "desktop";
export const BY_HUB = "hub";
export const BY_AGENT = "agent";
export const DIR_IN = "in";
export const DIR_OUT = "out";
export const JSONRPC = "2.0";
export const OUTCOME_SELECTED = "selected";
export const OUTCOME_CANCELLED = "cancelled";
export const KIND_REJECT_ONCE = "reject_once";
export const PUSH_QUIET = "quiet";
export const PUSH_NONE = "none";
export const PUSH_NORMAL = "normal";
export const WATCH_PUSH = [PUSH_QUIET, PUSH_NONE, PUSH_NORMAL];
export const USAGE_LIMIT = "usage_limit";
export const USAGE_LIMIT_RE = /usage.?limit|rate.?limit|quota|insufficient.?(balance|credit)|\b429\b|额度|限额/i;

export const ST = { starting: "starting", running: "running", waiting: "waiting", idle: "idle", error: "error", closed: "closed" };

export const M = {
  init: "initialize",
  newSession: "session/new",
  load: "session/load",
  resume: "session/resume",
  prompt: "session/prompt",
  cancel: "session/cancel",
  update: "session/update",
  perm: "session/request_permission",
  setMode: "session/set_mode",
  setModel: "session/set_model",
  setConfig: "session/set_config_option",
};
export const U = {
  message: "agent_message_chunk",
  thought: "agent_thought_chunk",
  user: "user_message_chunk",
  tool: "tool_call",
  toolUpdate: "tool_call_update",
  usage: "usage_update",
  mode: "current_mode_update",
  config: "config_option_update",
  info: "session_info_update",
};
export const EDIT_KINDS = new Set(["edit", "delete", "move"]);
export const SKIP_DIRS = new Set([".git", "node_modules"]);

const NPX = "npx";
const YES = "-y";
export const PRESETS = [
  { id: "claude", name: "Claude Code", kind: "claude", cmd: NPX, args: [YES, "@agentclientprotocol/claude-agent-acp"] },
  { id: "codex", name: "Codex", kind: "codex", cmd: NPX, args: [YES, "@agentclientprotocol/codex-acp"] },
  { id: "dsh", name: "DSH", kind: "dsh", cmd: NPX, args: [YES, "@openma/deepseek-harness-acp"] },
];
export const INSTANCE_KINDS = ["claude", "codex", "dsh", "custom"];

export const DEFAULT_SETTINGS = { watchPush: PUSH_QUIET, quietRepushSec: 60 };

const HIGH = "high";
const MID = "mid";
// 风险档只决定在哪答, 不替用户答; match 是不区分大小写的正则, 对 标题 + 内容 + 路径 匹配
export const DEFAULT_RULES = {
  v: 1,
  rules: [
    { level: HIGH, kind: "delete", why: "删除文件" },
    { level: HIGH, match: "(^|[\\s;&|(])rm\\s", why: "rm 删除" },
    { level: HIGH, match: "git\\s+push\\s+.*(--force|-f\\b)", why: "强制推送" },
    { level: HIGH, match: "(^|[\\s;&|(])sudo\\s", why: "sudo 提权" },
    { level: HIGH, match: "\\.env\\b|\\.ssh\\b|id_rsa|id_ed25519|\\.pem\\b", why: "碰到密钥或 .env" },
    { level: HIGH, match: "systemctl\\s+(restart|stop)", why: "重启服务" },
    { level: MID, match: "\\b(npm|pnpm|yarn|pip3?|cargo|go)\\s+(install|i|add|get)\\b", why: "安装依赖" },
    { level: MID, match: "\\b(curl|wget)\\s", why: "联网下载" },
    { level: MID, match: "git\\s+commit\\b", why: "git 提交" },
    { level: MID, kind: "fetch", why: "联网访问" },
    { level: MID, outside: true, why: "写工作区外" },
  ],
};
export const RISK_ORDER = ["low", MID, HIGH];
