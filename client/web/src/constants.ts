export const SERVER_URL: string = import.meta.env.VITE_AIOA_SERVER ?? "";
export const AUTH_TOKEN: string = import.meta.env.VITE_AIOA_TOKEN ?? "";

export const STORAGE_DEVICE = "aioa.device";
export const STORAGE_SINCE = "aioa.since";
export const DEVICE_PREFIX = "web";

export const HEARTBEAT_MS = 25_000;
export const RECONNECT_MIN_MS = 500;
export const RECONNECT_MAX_MS = 10_000;
export const HISTORY_PAGE = 100;

export const STATUS_ONLINE = "在线";
export const STATUS_OFFLINE = "重连中";
export const STATUS_NO_CONFIG = "未配置服务端地址";

export const QUERY_MOCK = "mock";
export const STORAGE_APPEARANCE = "aioa.appearance";
export const STORAGE_SPACE = "aioa.space";
export const STORAGE_ORDER = "aioa.order";
export const STORAGE_SAVED = "aioa.saved";
export const STORAGE_DONE = "aioa.done";

// 接口路径集中在这里, 服务端调整时只改一处
export const RULES_PATH = "/api/v1/rules";
export const SETTINGS_PATH = "/api/v1/settings";
export const SPACES_PATH = "/api/v1/spaces";
export const TASKS_PATH = "/api/v1/tasks";
export const SOURCES_PATH = "/api/v1/sources";

export const STALE_FACTOR = 2;
export const STALE_CHECK_MS = 15_000;
export const SERIES_LIMIT = 240;
export const EVENTS_LIMIT = 300;
export const WORTH_BATCH = 3;
export const HAPPENING_LIMIT = 5;
export const MOCK_TICK_MS = 2_000;
export const SYNC_DEBOUNCE_MS = 800;
export const MIN_CONTRAST = 3;

export const FIELD_EVENTS = "events";
export const FIELD_TASK = "task";
export const FIELD_REPORT = "report";
export const FIELD_STATUS = "status";
export const ANY = "*";

export const TXT_EMPTY = "暂无数据";
export const TXT_LOADING = "加载中";
export const TXT_ERROR = "数据出错";
export const TXT_STALE = "已过期";
export const TXT_CONFIRM_DANGER = "这是危险操作, 确定继续?";
export const TXT_SAVED = "已保存";
export const TXT_OFFLINE_SAVE = "未连接服务端, 只保存在本地";

// 反复使用的样式类名
export const CLS = {
  meta: "meta",
  cardList: "card list",
  primary: "btn primary",
  ghostSm: "btn ghost sm",
  sysBubble: "bubble sys",
} as const;

export const LAYER_TEXT = { need_me: "需要我", happening: "正在发生", worth_reading: "值得一看" } as const;
