export const HUB_NAME = "main";

export const FALLBACK_DELAY_MS = 1500;
export const HISTORY_DEFAULT_LIMIT = 100;
export const HISTORY_MAX_LIMIT = 500;
export const MAX_TEXT_LENGTH = 8000;

export const KEY_PENDING_SEQ = "pendingSeq";
export const KEY_ACKED_SEQ = "ackedSeq";
export const KEY_PUSH_TOKEN = "pushToken";

export const SRC_API_DEFAULT = "api";
export const UNKNOWN_DEVICE = "unknown";

export const HEADER_AUTH = "Authorization";
export const BEARER_PREFIX = "Bearer ";
export const CONTENT_TYPE_JSON = "application/json; charset=utf-8";

export const ERR_UNAUTHORIZED = "未授权";
export const ERR_NOT_FOUND = "路径不存在";
export const ERR_BAD_FRAME = "无法解析的帧";
export const ERR_BAD_BODY = "消息体格式错误";
export const ERR_TOO_LONG = "消息过长";
export const ERR_NEED_WS = "需要 WebSocket 升级请求";

export const PUSH_TITLE = "HX-AIOA";
export const MIPUSH_ENDPOINT = "https://api.xmpush.xiaomi.com/v3/message/regid";
export const WXPUSHER_ENDPOINT = "https://wxpusher.zjiecode.com/api/send/message";

export const NORMAL_CLOSE = 1000;
export const NO_STATUS_CLOSE = 1005;
export const ABNORMAL_CLOSE = 1006;
