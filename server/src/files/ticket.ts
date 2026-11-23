import { FILE_QUERY_EXPIRES, FILE_QUERY_TICKET, PATH_FILE_DATA } from "@hx-aioa/protocol";
import { hmac, safeEqual } from "../auth";
import type { Env } from "../env";

export type TicketVerb = "up" | "dl";

// 票据只认 Worker 与 Hub 都有的密钥; 上传票据还绑定登记的大小, 防止拿一张票塞更大的文件
const secretOf = (env: Env) => env.TOKEN_SECRET || env.AUTH_TOKEN;
const text = (verb: TicketVerb, id: string, exp: number, size: number) => `file:${verb}:${id}:${exp}:${size}`;

/** 带票据的字节地址 (相对路径), Worker 凭它直接读写 R2。 */
export async function ticketPath(env: Env, verb: TicketVerb, id: string, exp: number, size: number): Promise<string> {
  const sig = await hmac(secretOf(env), text(verb, id, exp, size));
  const q = new URLSearchParams({ [FILE_QUERY_TICKET]: sig, [FILE_QUERY_EXPIRES]: String(exp) });
  if (verb === "up") q.set("s", String(size));
  return `${PATH_FILE_DATA.replace("{id}", encodeURIComponent(id))}?${q}`;
}

/** 校验票据; 返回登记的大小 (下载票据为 0), 无效返回 null。 */
export async function checkTicket(env: Env, verb: TicketVerb, id: string, url: URL, now = Date.now()): Promise<number | null> {
  const sig = url.searchParams.get(FILE_QUERY_TICKET) ?? "";
  const exp = Number(url.searchParams.get(FILE_QUERY_EXPIRES));
  const size = verb === "up" ? Number(url.searchParams.get("s")) : 0;
  if (!sig || !Number.isFinite(exp) || exp < now || !Number.isFinite(size)) return null;
  return safeEqual(sig, await hmac(secretOf(env), text(verb, id, exp, size))) ? size : null;
}
