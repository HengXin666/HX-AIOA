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
