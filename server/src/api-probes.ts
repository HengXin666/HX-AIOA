import { PATH_PROBES, PATH_SHELL_TICKET, type KeyRequest, type Scope } from "@hx-aioa/protocol";
import { CODE_FORBIDDEN, POST } from "./constants";
import { OWNER, type ReqCtx, type Route, route } from "./core";
import { fail, json, readJson } from "./http";

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const AGENT_UA = "hx-aioa-agent/1";
const INSTALL_PATH = "/install.sh";
const FAIL_LIMIT = 5;
const LOCK_MS = 5 * 60_000;
const ERR_NAME = "名字只能用小写字母, 数字和 -, 最长 32 位";
const ERR_OWNER = "只有主账号能打开终端";
const ERR_PASSWORD = "密码不对";
const ERR_LOCKED = "密码错误次数过多, 5 分钟后再试";

// 密码失败计数只放内存: DO 被回收即清零, 不写库
const failures = { n: 0, until: 0 };

type Body = Record<string, unknown> | undefined;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

// 添加主机: 建一把只给这台机器用的 key (主体绑定名字), 返回一行安装命令; key 只出现这一次
async function createProbe(c: ReqCtx): Promise<Response> {
  const b = (await readJson(c.req)) as Body;
  const name = str(b?.name).toLowerCase();
  if (!NAME_RE.test(name)) return fail(400, ERR_NAME);
  const shell = b?.shell === true;
  const agent = b?.agent === true;
  const scopes: Scope[] = ["probe", ...(shell ? (["probe:shell"] as const) : []), ...(agent ? (["probe:agent"] as const) : [])];
  const req: KeyRequest = { name: `探针 ${name}`, scopes, subject: name };
  const { info, key } = await c.core.registry.createKey(req);
  const origin = c.url.origin;
  const flags = [`--server ${origin}`, `--key ${key}`, `--name ${name}`, ...(shell ? ["--shell"] : []), ...(agent ? ["--agent"] : [])].join(" ");
  const command = `curl -fsSL -A ${AGENT_UA} ${origin}${INSTALL_PATH} | sh -s -- ${flags}`;
  return json({ id: info.id, subject: name, shell, agent, key, command });
}

/** 主账号复核密码: 终端票据与 Agent GUI 配对共用一个失败计数 (5 次错锁 5 分钟); 通过返回 null。 */
export async function ownerPassword(c: ReqCtx, password: unknown, errOwner = ERR_OWNER): Promise<Response | null> {
  const who = c.who;
  if (!who.owner || who.user?.role !== "owner") return fail(403, errOwner, CODE_FORBIDDEN);
  const now = Date.now();
  if (failures.until > now) return fail(429, ERR_LOCKED);
  if (!(await c.core.checkPassword(who.user.id, typeof password === "string" ? password : ""))) {
    failures.n += 1;
    if (failures.n >= FAIL_LIMIT) failures.until = now + LOCK_MS;
    return fail(403, ERR_PASSWORD, CODE_FORBIDDEN);
  }
  failures.n = 0;
  return null;
}

/** 测试用: 清掉密码失败计数。 */
export function resetPasswordFailures(): void {
  failures.n = 0;
  failures.until = 0;
}

// 终端票据: 每次打开终端都要 owner 重新输入密码, 换一张 60 秒的一次性票据
async function shellTicket(c: ReqCtx): Promise<Response> {
  const b = (await readJson(c.req)) as Body;
  const subject = str(b?.subject);
  if (!subject && c.who.owner && c.who.user?.role === "owner") return fail(400, "需要 subject");
  const denied = await ownerPassword(c, b?.password);
  if (denied) return denied;
  if (!c.core.terms.probeFor(subject)) return fail(409, "主机不在线或没有开启终端");
  return json(await c.core.terms.ticket(subject));
}

export const PROBE_ROUTES: Route[] = [route(POST, PATH_PROBES, OWNER, createProbe), route(POST, PATH_SHELL_TICKET, OWNER, shellTicket)];
