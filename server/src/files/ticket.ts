import { FILE_QUERY_EXPIRES, FILE_QUERY_TICKET, type FileStoreKind, PATH_FILE_DATA } from "@hx-aioa/protocol";
import { hmac, safeEqual } from "../auth";
import type { Env } from "../env";

export type TicketVerb = "up" | "dl";

// 票据只认 Worker 与 Hub 都有的密钥; 上传票据还绑定登记的大小, 防止拿一张票塞更大的文件;
// 上传到 Drive 的票据另带后端 (签进去, 改不了), R2 票据的签名内容与以前一样
const secretOf = (env: Env) => env.TOKEN_SECRET || env.AUTH_TOKEN;
const QUERY_STORE = "b";
const text = (verb: TicketVerb, id: string, exp: number, size: number, store: FileStoreKind) =>
  `file:${verb}:${id}:${exp}:${size}${store === "r2" ? "" : `:${store}`}`;

/** 带票据的字节地址 (相对路径), Worker 凭它直接读写 R2。 */
export async function ticketPath(env: Env, verb: TicketVerb, id: string, exp: number, size: number, store: FileStoreKind = "r2"): Promise<string> {
  const sig = await hmac(secretOf(env), text(verb, id, exp, size, store));
  const q = new URLSearchParams({ [FILE_QUERY_TICKET]: sig, [FILE_QUERY_EXPIRES]: String(exp) });
  if (verb === "up") q.set("s", String(size));
  if (store !== "r2") q.set(QUERY_STORE, store);
  return `${PATH_FILE_DATA.replace("{id}", encodeURIComponent(id))}?${q}`;
}

/** 校验票据; 返回登记的大小 (下载票据为 0) 与后端, 无效返回 null。 */
export async function checkTicket(env: Env, verb: TicketVerb, id: string, url: URL, now = Date.now()): Promise<{ size: number; store: FileStoreKind } | null> {
  const sig = url.searchParams.get(FILE_QUERY_TICKET) ?? "";
  const exp = Number(url.searchParams.get(FILE_QUERY_EXPIRES));
  const size = verb === "up" ? Number(url.searchParams.get("s")) : 0;
  const store: FileStoreKind = url.searchParams.get(QUERY_STORE) === "cfd" ? "cfd" : "r2";
  if (!sig || !Number.isFinite(exp) || exp < now || !Number.isFinite(size)) return null;
  return safeEqual(sig, await hmac(secretOf(env), text(verb, id, exp, size, store))) ? { size, store } : null;
}
