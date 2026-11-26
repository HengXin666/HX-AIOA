import { API_V1 } from "./constants";

// hxoa 管理 (无 Agent 的内置插件 hengxin666.hxoa, #104): 用 hxoa 的管理令牌 (hxadm_) 远程管理一台或多台 hxoa 服务端,
// 相当于把 hxoa 面板搬进 App: 工作区增删改, 选目录 / 新建文件夹, 连接令牌, 一键复制连接提示。
// 管理令牌只存在服务端 (加密), 客户端只拿到名字和地址; 只有主人能用。需要 hxoa 2.4.0+。
export const HXOA_PLUGIN = "hengxin666.hxoa";
export const HXOA_MAX_CONNS = 20;
export const HXOA_ADMIN_PREFIX = "hxadm_";
// 接入种类: admin 是管理令牌; agent 是 #97 旧版存的工作区令牌, 只能删除重接
export const HXOA_KIND_ADMIN = "admin";
export const HXOA_KIND_AGENT = "agent";

export const PATH_HXOA = `${API_V1}/hxoa`;
export const PATH_HXOA_ONE = `${API_V1}/hxoa/{id}`;
export const PATH_HXOA_STATE = `${API_V1}/hxoa/{id}/state`;
export const PATH_HXOA_BROWSE = `${API_V1}/hxoa/{id}/browse`;
export const PATH_HXOA_MKDIR = `${API_V1}/hxoa/{id}/mkdir`;
export const PATH_HXOA_WS = `${API_V1}/hxoa/{id}/workspaces`;
export const PATH_HXOA_WS_ONE = `${API_V1}/hxoa/{id}/workspaces/{ws}`;
export const PATH_HXOA_WS_TOKENS = `${API_V1}/hxoa/{id}/workspaces/{ws}/tokens`;
export const PATH_HXOA_TOKEN = `${API_V1}/hxoa/{id}/tokens/{tok}`;
export const PATH_HXOA_TOKEN_PROMPT = `${API_V1}/hxoa/{id}/tokens/{tok}/prompt`;
export const PATH_HXOA_TOKEN_MERGE = `${API_V1}/hxoa/{id}/tokens/{tok}/merge`;

// hxoa 的 /admin/v1/hello: 版本, 管理令牌名, 公网地址
export type HxoaHello = { server: string; admin: string; publicUrl: string };
// 一条接入; hello 缺省 = 这次没连上, error 是原因; kind 为 agent 时是旧版工作区令牌
export type HxoaConn = { id: string; name: string; base: string; at: number; kind: string; hello?: HxoaHello; error?: string };
export type HxoaConnInput = { name: string; base: string; token: string };

// worker 模式下连接令牌自己的工作树状态
export type HxoaWorker = { exists: boolean; branch: string; ahead?: string; behind?: string; dirty?: string[] };
// 连接令牌: 不含密钥本身, 要密钥就取连接提示
export type HxoaToken = { id: string; label: string; online: boolean; lastSeen?: string; lastIp?: string; ops: number; worker?: HxoaWorker };
export type HxoaWorkspace = { id: string; name: string; path: string; workers: boolean; exec: boolean; git: boolean; branch?: string; online: number; tokens: HxoaToken[] };
export type HxoaTunnel = { mode: string; state: string; url?: string; error?: string };
export type HxoaState = { server: string; publicUrl: string; tunnel?: HxoaTunnel; workspaces: HxoaWorkspace[] };
export type HxoaBrowse = { path: string; parent: string; dirs: string[]; git: boolean };
export type HxoaWsInput = { name: string; path: string; workers: boolean; exec: boolean };
export type HxoaWsPatch = { name?: string; workers?: boolean; exec?: boolean };
export type HxoaNewToken = { token: HxoaToken; prompt: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const NAME_MAX = 40;
const PATH_MAX = 1024;
// 与 hxoa 的身份名规则一致
const LABEL_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,31}$/;

/** 新接入: 名字 1~40 字, 地址必须是 https (本机调试允许 http://localhost / 127.0.0.1), 令牌是 hxadm_ 开头的管理令牌。 */
export function parseHxoaConn(raw: unknown): HxoaConnInput | string {
  if (!isObj(raw)) return "需要 { name, base, token }";
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name || name.length > NAME_MAX) return "name 为 1 到 40 字";
  const token = typeof raw.token === "string" ? raw.token.trim() : "";
  if (!token.startsWith(HXOA_ADMIN_PREFIX) || token.length > 512) return "token 是 hxoa 面板 远程管理 里建的管理令牌 (hxadm_ 开头)";
  if (typeof raw.base !== "string") return "base 是 hxoa 服务地址";
  let u: URL;
  try {
    u = new URL(raw.base.trim());
  } catch {
    return "base 不是网址";
  }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !(local && u.protocol === "http:")) return "base 需要 https";
  if (u.username || u.password || u.search || u.hash) return "base 只写地址, 不带账号, 参数";
  return { name, base: u.origin + u.pathname.replace(/\/+$/, ""), token };
}

const absPath = (v: unknown) => typeof v === "string" && v.trim().length > 0 && v.length <= PATH_MAX && !v.includes("\0");

/** 添加工作区: path 是 hxoa 所在机器上的绝对路径 (或 ~ 开头)。 */
export function parseHxoaWs(raw: unknown): HxoaWsInput | string {
  if (!isObj(raw) || !absPath(raw.path)) return "path 是目录路径";
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (name.length > NAME_MAX) return "name 最多 40 字";
  return { name, path: (raw.path as string).trim(), workers: raw.workers === true, exec: raw.exec !== false };
}

export function parseHxoaWsPatch(raw: unknown): HxoaWsPatch | string {
  if (!isObj(raw)) return "需要 { name?, workers?, exec? }";
  const out: HxoaWsPatch = {};
  if (raw.name !== undefined) {
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    if (!name || name.length > NAME_MAX) return "name 为 1 到 40 字";
    out.name = name;
  }
  for (const k of ["workers", "exec"] as const) {
    if (raw[k] === undefined) continue;
    if (typeof raw[k] !== "boolean") return `${k} 是布尔值`;
    out[k] = raw[k] as boolean;
  }
  return Object.keys(out).length ? out : "没有要改的";
}

/** 连接令牌的身份名: 字母数字 . _ -, 最长 32。 */
export function parseHxoaLabel(raw: unknown): string {
  const label = isObj(raw) && typeof raw.label === "string" ? raw.label.trim() : "";
  return LABEL_RE.test(label) ? label : "";
}

/** 新建文件夹: 上级目录 + 一段名字, 名字不能含 / 或 \。 */
export function parseHxoaMkdir(raw: unknown): { parent: string; name: string } | string {
  if (!isObj(raw) || !absPath(raw.parent)) return "parent 是上级目录";
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name || name === "." || name === ".." || name.length > 255 || /[/\\\0]/.test(name)) return "文件夹名不能为空, 不能含 / 或 \\";
  return { parent: (raw.parent as string).trim(), name };
}

/** hxoa 的 id 都是十六进制, 拼进路径前先校验, 防止转发到别的接口。 */
export const isHxoaId = (s: string) => /^[0-9a-f]{1,32}$/.test(s);
