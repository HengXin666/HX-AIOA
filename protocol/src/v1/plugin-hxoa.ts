import { API_V1 } from "./constants";

// hxoa 接入 (无 Agent 的内置插件 hengxin666.hxoa, #97): 接入一台或多台 hxoa 服务端 (远程工作区), 在 App 里看文件, 跑命令。
// 令牌只存在服务端 (加密), 客户端只拿到名字和地址; 只有主人能用。
export const HXOA_PLUGIN = "hengxin666.hxoa";
export const HXOA_MAX_CONNS = 20;
export const HXOA_EXEC_MAX_SEC = 60;
// 转给客户端的输出上限, 超出截断并标 truncated
export const HXOA_OUT_MAX = 256 * 1024;

export const PATH_HXOA = `${API_V1}/hxoa`;
export const PATH_HXOA_ONE = `${API_V1}/hxoa/{id}`;
export const PATH_HXOA_LS = `${API_V1}/hxoa/{id}/ls`;
export const PATH_HXOA_READ = `${API_V1}/hxoa/{id}/read`;
export const PATH_HXOA_EXEC = `${API_V1}/hxoa/{id}/exec`;
export const PATH_HXOA_MKDIR = `${API_V1}/hxoa/{id}/mkdir`;

// hxoa 的 /v1/hello: 工作区, 身份, 模式 (direct / worker), worker 分支与基线分支, 是否允许执行命令
export type HxoaHello = { server: string; workspace: string; identity: string; root: string; mode: string; branch?: string; base?: string; exec: boolean };
// 一条接入; hello 缺省 = 这次没连上, error 是原因
export type HxoaConn = { id: string; name: string; base: string; at: number; hello?: HxoaHello; error?: string };
export type HxoaEntry = { p: string; d?: boolean; b?: number };
export type HxoaLs = { entries: HxoaEntry[]; truncated?: boolean };
export type HxoaRead = { version: string; lines: number; start: number; end: number; content: string; binary?: boolean };
export type HxoaExecInput = { cmd: string; dir?: string; timeout?: number };
export type HxoaExec = { code: number; stdout: string; stderr: string; ms: number; timedOut?: boolean; truncated?: boolean };
export type HxoaConnInput = { name: string; base: string; token: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** 新接入: 名字 1~40 字, 地址必须是 https (本机调试允许 http://localhost / 127.0.0.1), 令牌 8~512 字。 */
export function parseHxoaConn(raw: unknown): HxoaConnInput | string {
  if (!isObj(raw)) return "需要 { name, base, token }";
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name || name.length > 40) return "name 为 1 到 40 字";
  const token = typeof raw.token === "string" ? raw.token.trim() : "";
  if (token.length < 8 || token.length > 512) return "token 不对";
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

/** 新建文件夹: 工作区内的相对路径, 不能含 .. 段 (hxoa 也会拦)。 */
export function parseHxoaMkdir(raw: unknown): string {
  if (!isObj(raw) || typeof raw.path !== "string") return "";
  const p = raw.path.trim().replace(/^\/+|\/+$/g, "");
  if (!p || p.length > 400 || p.split("/").some((s) => s === ".." || s === "")) return "";
  return p;
}

export function parseHxoaExec(raw: unknown): HxoaExecInput | string {
  if (!isObj(raw) || typeof raw.cmd !== "string" || !raw.cmd.trim() || raw.cmd.length > 4000) return "cmd 为 1 到 4000 字";
  const out: HxoaExecInput = { cmd: raw.cmd };
  if (raw.dir !== undefined) {
    if (typeof raw.dir !== "string" || raw.dir.length > 400) return "dir 是工作区内的相对路径";
    out.dir = raw.dir;
  }
  if (raw.timeout !== undefined) {
    if (!(typeof raw.timeout === "number" && Number.isInteger(raw.timeout) && raw.timeout > 0 && raw.timeout <= HXOA_EXEC_MAX_SEC)) return `timeout 为 1 到 ${HXOA_EXEC_MAX_SEC} 秒`;
    out.timeout = raw.timeout;
  }
  return out;
}
