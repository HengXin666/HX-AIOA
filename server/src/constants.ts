export const HUB_NAME = "main";
export const OWNER_ID = "owner";
export const DEFAULT_TZ = "Asia/Shanghai";

export const FALLBACK_DELAY_MS = 1500;
export const HISTORY_DEFAULT_LIMIT = 100;
export const HISTORY_MAX_LIMIT = 500;
export const MAX_TEXT_LENGTH = 8000;
export const RECENT_SCAN = 300;
export const OVERVIEW_SCAN = 1000;
export const METRIC_PERSIST_MS = 300_000;
// 安卓后台常驻连接的设备 id 前缀: 只收消息与通知, 不收 "谁在监听 / 输入" 这类界面帧, 免得空推唤醒手机
export const BG_DEVICE_PREFIX = "android-link-";

export const KEY_PENDING_SEQ = "pendingSeq";
export const KEY_ACKED_SEQ = "ackedSeq";
export const KEY_PUSH_TOKEN = "pushToken";
export const KV_RULES = "rules";
export const KV_SETTINGS = "settings";
export const KV_SPACES = "spaces";
export const KV_TIMERS = "timers";
export const KV_AGG_PREFIX = "agg:";
export const TIMER_FALLBACK = "fallback";
export const TIMER_AGG_PREFIX = "agg:";
export const TIMER_PROMPT_PREFIX = "prompt:";

export const DEFAULT_RATE_PER_MIN = 120;
export const KEY_PREFIX_SHOWN = 8;
export const WEBHOOK_SECRET_PREFIX = "whs_";
export const MAX_SETTING_BYTES = 16_000;
export const MAX_SETTING_KEYS = 64;
export const MAX_USER_RULES = 100;

export const AGENT_ONLINE_MS = 120_000;
export const AGENT_SEEN_PERSIST_MS = 600_000;
export const ACTION_QUEUE_MS = 24 * 3600_000;
export const PROGRESS_PERSIST_MS = 30_000;
export const TASK_LOG_LIMIT = 500;
export const TASK_ENVELOPE_PREFIX = "t_";

export const SRC_API_DEFAULT = "api";
export const SRC_SYSTEM = "system";
export const UNKNOWN_DEVICE = "unknown";
export const PROTO_LEGACY = "legacy";
export const PROTO_V1 = "v1";

export const HEADER_AUTH = "Authorization";
export const BEARER_PREFIX = "Bearer ";
export const CONTENT_TYPE_JSON = "application/json; charset=utf-8";
export const HEADER_CONTENT_TYPE = "Content-Type";

export const CODE_BAD_REQUEST = "bad_request";
export const CODE_UNAUTHORIZED = "unauthorized";
export const CODE_FORBIDDEN = "forbidden";
export const CODE_NOT_FOUND = "not_found";
export const CODE_CONFLICT = "conflict";
export const CODE_PLUGIN_CONFLICT = "plugin_conflict";
export const CODE_NEED_CONFIRM = "need_confirm";
export const CODE_EXPIRED = "expired";
export const CODE_RATE_LIMITED = "rate_limited";
export const CODE_NOT_CONFIGURED = "not_configured";

export const ERR_UNAUTHORIZED = "未授权";
export const ERR_FORBIDDEN = "没有权限";
export const ERR_NOT_FOUND = "路径不存在";
export const ERR_NO_RESOURCE = "资源不存在";
export const ERR_BAD_FRAME = "无法解析的帧";
export const ERR_BAD_BODY = "消息体格式错误";
export const ERR_BAD_JSON = "请求体必须是 JSON";
export const ERR_TOO_LONG = "消息过长";
export const ERR_NEED_WS = "需要 WebSocket 升级请求";
export const ERR_RATE = "超过每分钟限速";
export const ERR_NEED_SECRET = "服务端未设置 TOKEN_SECRET";
export const ERR_BAD_SIGNATURE = "签名校验失败";

export const PUSH_TITLE = "HX-AIOA";
export const MIPUSH_ENDPOINT = "https://api.xmpush.xiaomi.com/v3/message/regid";
export const WXPUSHER_ENDPOINT = "https://wxpusher.zjiecode.com/api/send/message";

export const NORMAL_CLOSE = 1000;
export const NO_STATUS_CLOSE = 1005;
export const ABNORMAL_CLOSE = 1006;

export const GET = "GET";
export const POST = "POST";
export const PUT = "PUT";
export const PATCH = "PATCH";
export const DELETE = "DELETE";

export const GITHUB_KEEP = 30;
export const GITHUB_SYNC_RUNS = 10;
export const GITHUB_SYNC_MAX_REPOS = 10;
export const GITHUB_PAGE_SIZE = 100;
export const GITHUB_API = "https://api.github.com";
export const GITHUB_USER_AGENT = "HX-AIOA";
export const GITHUB_SUBJECT_PREFIX = "github:";
export const GITHUB_WEB = "https://github.com";
export const KV_GITHUB_SYNCED = "githubSyncedAt";
export const KV_GITHUB_PICKS = "githubPicks";
export const KV_GITHUB_LOGIN = "githubLogin";
// 解析规则变化时换键名, 让下一次同步重新拉全量并改写旧行
export const KV_GITHUB_ACTIVITY_ETAG = "githubActivityEtag:2";
export const KV_GITHUB_ACTIVITY_SYNCED = "githubActivitySyncedAt";
export const ERR_NO_GITHUB_TOKEN = "服务端没有配置 GITHUB_TOKEN";
export const GITHUB_ADAPTER = "github";

// 群键规则与安卓端 groupKey() 一致: 有 channel 用 channel, 本机发的归备忘, 否则按来源名
export const MEMO_GROUP = "备忘";
export const DEVICE_PREFIX = "android";
export { USER_SOURCE_PREFIX } from "@hx-aioa/protocol";
// 没有账号 (旧的 AUTH_TOKEN 连接) 时人发消息的显示名
export const OWNER_NAME = "主人";

// 免费计划每日 Worker 请求额度 (CF 额度卡与站点占比共用)
export const WORKER_DAY_LIMIT = 100_000;
// 仓库详情里最多留几个活跃分支
export const GITHUB_BRANCHES = 8;

// 云 Agent skill 化 (protocol agent-skill.ts)
export const CODE_SKILL_EXPIRED = "skill_major_expired";
export const QUERY_BRIEF = "brief";
export const QUERY_START = "start";
export const QUERY_MEMORY = "memory";
export const FLAG_ON = "1";
export const DAY_MS = 86_400_000;
