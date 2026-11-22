import { API_V1 } from "./constants";

// 本分支服务端已实现的 HTTP 路径, 带 {x} 的段由调用方替换 (记得 encodeURIComponent)
export const PATH_EVENTS = `${API_V1}/events`;
export const PATH_EVENT_RESOLVE = `${API_V1}/events/{id}/resolve`;
export const PATH_EVENT_ACTIONS = `${API_V1}/events/{id}/actions`;
export const PATH_REPORTS = `${API_V1}/reports`;
export const PATH_EVENT_GROUPS = `${API_V1}/event-groups`;
export const PATH_MESSAGES = `${API_V1}/messages`;
export const PATH_OVERVIEW = `${API_V1}/overview`;
export const PATH_METRICS_LATEST = `${API_V1}/metrics/latest`;
export const PATH_RULES = `${API_V1}/rules`;
export const PATH_RULES_ORDER = `${API_V1}/rules/order`;
export const PATH_RULES_TEST = `${API_V1}/rules/test`;
export const PATH_SETTINGS = `${API_V1}/settings`;
export const PATH_KEYS = `${API_V1}/keys`;
export const PATH_SOURCES = `${API_V1}/sources`;
export const PATH_INTEGRATIONS = `${API_V1}/integrations`;
export const PATH_SOURCE_TYPES = `${API_V1}/source-types`;
export const PATH_HOOKS = `${API_V1}/hooks`;
export const PATH_AGENTS = `${API_V1}/agents`;
export const PATH_AGENT_REGISTER = `${API_V1}/agent/register`;
export const PATH_AGENT_TASKS = `${API_V1}/agent/tasks`;
export const PATH_AGENT_ACTIONS = `${API_V1}/agent/actions`;
export const PATH_TASKS = `${API_V1}/tasks`;
export const PATH_GITHUB_REPOS = `${API_V1}/github/repos`;
export const PATH_GITHUB_REPO = `${API_V1}/github/repos/{owner}/{name}`;
export const PATH_GITHUB_SYNC = `${API_V1}/github/sync`;
export const PATH_GITHUB_AVAILABLE = `${API_V1}/github/available`;
export const PATH_GITHUB_TRACKED = `${API_V1}/github/tracked`;
export const PATH_GITHUB_ACTIVITY = `${API_V1}/github/activity`;

export const QUERY_KIND = "kind";
export const QUERY_BEFORE = "before";
export const QUERY_STATE = "state";
export const QUERY_AGENT = "agent";
export const QUERY_SUBJECTS = "subjects";
export const PATH_SPACES = `${API_V1}/spaces`;
export const PATH_SPACE = `${API_V1}/spaces/{id}`;
export const PATH_SPACE_STATE = `${API_V1}/spaces/{id}/state`;
export const PATH_SPACE_DATA = `${API_V1}/spaces/{id}/data`;
// 工作台按钮动作的 taskId 前缀: button:<spaceId>:<itemId>
export const BUTTON_TASK_PREFIX = "button:";

// 账号 (§1): 初始化, 登录, 我, 邀请, 用户管理, 群组, 审计
export const PATH_SETUP = `${API_V1}/setup`;
export const PATH_AUTH_LOGIN = `${API_V1}/auth/login`;
export const PATH_AUTH_REFRESH = `${API_V1}/auth/refresh`;
export const PATH_AUTH_LOGOUT = `${API_V1}/auth/logout`;
export const PATH_JOIN = `${API_V1}/join`;
export const PATH_ME = `${API_V1}/me`;
export const PATH_ME_PASSWORD = `${API_V1}/me/password`;
export const PATH_ME_DEVICE = `${API_V1}/me/devices/{id}`;
export const PATH_INVITES = `${API_V1}/invites`;
export const PATH_USERS = `${API_V1}/users`;
export const PATH_USER = `${API_V1}/users/{id}`;
export const PATH_USER_APPROVE = `${API_V1}/users/{id}/approve`;
export const PATH_GROUPS = `${API_V1}/groups`;
export const PATH_GROUP = `${API_V1}/groups/{id}`;
export const PATH_AUDIT = `${API_V1}/audit`;
export const PATH_PROBES = `${API_V1}/probes`;
export const PATH_SHELL_TICKET = `${API_V1}/shell/ticket`;
export const PATH_CF_USAGE = `${API_V1}/cf/usage`;
export const PATH_CF_ZONES = `${API_V1}/cf/zones`;
