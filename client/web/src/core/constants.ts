// 本地存储键
export const STORAGE_REFRESH = "aioa.refresh";
export const STORAGE_DEVICE = "aioa.device";
export const STORAGE_HINT_APK = "aioa.hint.apk";
export const STORAGE_PANE = "aioa.pane";

// 设备 id 前缀: android 开头的走 ACK 与厂商推送, web- 开头的走 Web Push (页面开着时不发)
export const DEVICE_PREFIX = "web-";
export const PLATFORM_WEB = "web";

export const HEARTBEAT_MS = 25_000;
export const RECONNECT_MIN_MS = 1_000;
export const RECONNECT_MAX_MS = 30_000;
// 访问令牌提前这么久换新, 避免请求途中过期
export const REFRESH_EARLY_MS = 60_000;
export const PAGE_SIZE = 50;
export const RECENT_SIZE = 300;

export const MEMO_GROUP = "备忘";
export const APK_URL = "https://github.com/HengXin666/HX-AIOA/releases/latest";
export const VERSION_URL = "/version.json";
// 外链一律新标签页打开, 不带来源也不让新页面拿到 window.opener
export const EXTERNAL = { target: "_blank", rel: "noopener noreferrer" } as const;

// 断点 (px): 与 docs/design/web-arch.md 第 4 节一致
export const BP_WIDE = 1280;
export const BP_MID = 720;

export const TXT_LOADING = "加载中";
export const TXT_EMPTY_CHATS = "还没有会话";
export const TXT_PICK_CHAT = "选一个会话开始";
export const TXT_NETWORK = "连不上服务端";

// W2: 连接共享, 缓存, 消息
export const LOCK_LEADER = "aioa.link.leader";
export const LOCK_TAB_PREFIX = "aioa.link.tab.";
export const LOCK_REFRESH = "aioa.refresh";
export const CHANNEL_LINK = "aioa.link";
// 页面等令牌的上限; 超时当作没登录, 按断线处理
export const TOKEN_WAIT_MS = 10_000;
export const CACHE_DB = "aioa";
export const CACHE_KEEP = 100;
export const CACHE_WRITE_DELAY_MS = 800;
export const SEND_TIMEOUT_MS = 10_000;
export const READ_DELAY_MS = 1_500;

// W4: 图表与资源
export const LIVE_DRAW_GAP_MS = 1_000;
export const METRIC_KEEP = 1_440;
export const LIVE_WINDOW_MS = 5 * 60_000;

export const TXT_NOT_FOUND = "没有找到";
export const TXT_RETRY = "重试";
export const TXT_LOAD_MORE = "加载更多";

// 日期时间显示的区域设置
export const LOCALE = "zh-CN";

// 任务与 Agent 栏 (对照安卓 FeedState / AgentPage)
export const LAYER_MAX = 20;
export const AID_LENGTH = 16;
export const ACT_QUEUED = "queued";
export const HARNESS = "agent harness";
export const TXT_ACT_OFFLINE = "未连接服务端, 操作没有发出";
export const TXT_ACT_QUEUED = `${HARNESS} 离线, 已排队, 上线后送达`;
export const TXT_ACT_FAILED = "操作失败";
// 群里接入的 Agent 在界面上的统称 (与安卓 Constants.CLOUD_AGENT 一致)
export const CLOUD_AGENT_LABEL = "群 Agent";
