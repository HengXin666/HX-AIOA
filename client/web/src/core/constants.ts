// 本地存储键
export const STORAGE_REFRESH = "aioa.refresh";
export const STORAGE_DEVICE = "aioa.device";
export const STORAGE_HINT_APK = "aioa.hint.apk";
export const STORAGE_PANE = "aioa.pane";

// 设备 id 前缀: 服务端只把 android 开头的当手机参与兜底推送, web 不参与
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
