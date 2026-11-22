// 账号模块常量
export const ACCESS_TTL_SEC = 3600;
export const REFRESH_TTL_MS = 60 * 24 * 3600_000;
export const INVITE_DEFAULT_HOURS = 72;
export const INVITE_MAX_HOURS = 30 * 24;
export const PBKDF2_ITERATIONS = 100_000;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 256;
// 用户名保留大小写, 唯一性与登录都不区分大小写
export const NAME_RE = /^[A-Za-z0-9_.-]{2,32}$/;
export const DISPLAY_MAX = 64;
export const AUDIT_DEFAULT = 100;
export const AUDIT_MAX = 500;
export const LOGIN_FAIL_LIMIT = 10;
export const LOGIN_FAIL_WINDOW_MS = 15 * 60_000;
export const KICK_CODE = 4001;
export const KICK_REASON = "会话已被吊销";

// 内部转发头: Worker 会剥掉外部传入的同名头, 只有主 Hub 转发给子号 DO 时才带
export const HEADER_INTERNAL_USER = "X-Aioa-User";
export const USER_HUB_PREFIX = "u:";
export const SESSION_TAG_PREFIX = "s:";

export const USER_ID_PREFIX = "u_";
export const SESSION_ID_PREFIX = "s_";
export const INVITE_ID_PREFIX = "inv_";
export const GROUP_ID_PREFIX = "g_";
export const ACTOR_LEGACY = "AUTH_TOKEN";
export const PLATFORM_UNKNOWN = "unknown";
export const DEVICE_UNNAMED = "未命名设备";

export const ERR_NEED_SETUP_CODE = "服务端未设置 SETUP_CODE";
export const ERR_SETUP_DONE = "母号已初始化";
export const ERR_BAD_SETUP_CODE = "初始化口令错误";
export const ERR_BAD_LOGIN = "用户名或密码错误";
export const ERR_PENDING = "账号等待管理员批准";
export const ERR_DISABLED = "账号已被禁用";
export const ERR_TOO_MANY = "失败次数过多, 请稍后再试";
export const ERR_BAD_NAME = "用户名需为 2-32 位字母, 数字或 _ . -";
export const ERR_BAD_PASSWORD = "密码至少 8 位";
export const ERR_NAME_TAKEN = "用户名已被占用";
export const ERR_BAD_INVITE = "邀请码无效";
export const ERR_INVITE_EXPIRED = "邀请码已过期";
export const ERR_BAD_REFRESH = "刷新令牌无效或已过期";
export const ERR_WRONG_OLD = "原密码错误";
export const ERR_NO_USER = "用户不存在";
export const ERR_NO_GROUP = "群组不存在";
export const ERR_GROUP_TAKEN = "群组名已被占用";
export const ERR_NEED_USER = "需要用账号登录";
export const ERR_MEMBER_NO_KEYS = "子号暂不支持接入 key 与来源";
export const ERR_OWNER_LOCKED = "不能修改母号";
