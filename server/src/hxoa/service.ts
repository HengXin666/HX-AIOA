import { HXOA_EXEC_MAX_SEC, HXOA_MAX_CONNS, HXOA_OUT_MAX, type HxoaConn, type HxoaConnInput, type HxoaExec, type HxoaExecInput, type HxoaHello, type HxoaLs, type HxoaRead } from "@hx-aioa/protocol";
import type { Env } from "../env";
import { seal, unseal } from "../gh/crypto";
import { ApiFail } from "../http";

export const HXOA_CODE = "hxoa";
// 连不上的 hxoa 不拖慢列表
const HELLO_MS = 5000;
// 执行命令多等几秒: hxoa 自己按 timeout 杀进程, 再加上传输
const EXEC_SLACK_MS = 10_000;
const DEFAULT_MS = 20_000;
const ID_BYTES = 6;

type Row = { id: string; name: string; base: string; token: string; at: number };

const hex = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");

function cut(s: unknown): [string, boolean] {
  const t = typeof s === "string" ? s : "";
  return t.length > HXOA_OUT_MAX ? [t.slice(0, HXOA_OUT_MAX), true] : [t, false];
}

/** hxoa 接入: 每条 = 名字 + 服务地址 + 令牌 (密文); 操作都由服务端带令牌转给 hxoa 的 agent 接口 (/v1/*)。 */
export class HxoaService {
  constructor(
    private readonly env: Env,
    private readonly sql: SqlStorage,
  ) {
    sql.exec("CREATE TABLE IF NOT EXISTS hxoa_conn (id TEXT PRIMARY KEY, name TEXT NOT NULL, base TEXT NOT NULL, token TEXT NOT NULL, at INTEGER NOT NULL)");
  }

  private get secret(): string {
    return this.env.TOKEN_SECRET || this.env.AUTH_TOKEN;
  }

  private rows(): Row[] {
    return this.sql.exec<Row>("SELECT id, name, base, token, at FROM hxoa_conn ORDER BY at").toArray();
  }

  private row(id: string): Row {
    const r = this.sql.exec<Row>("SELECT id, name, base, token, at FROM hxoa_conn WHERE id = ?", id).toArray()[0];
    if (!r) throw new ApiFail(404, "not_found", "没有这条 hxoa 接入");
    return r;
  }

  /** 带令牌调 hxoa; hxoa 的错误 ({error, code}) 原样带回, 401 说明令牌被删了。 */
  private async call<T>(base: string, token: string, path: string, init: { body?: unknown; ms?: number } = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(base + path, {
        method: init.body === undefined ? "GET" : "POST",
        headers: { Authorization: `Bearer ${token}`, ...(init.body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        signal: AbortSignal.timeout(init.ms ?? DEFAULT_MS),
      });
    } catch (e) {
      throw new ApiFail(502, HXOA_CODE, `连不上 hxoa: ${e instanceof Error ? e.message : String(e)}`);
    }
    const text = await res.text();
    let body: Record<string, unknown> | null = null;
    try {
      body = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      body = null;
    }
    if (!res.ok || !body) {
      const msg = body && typeof body.error === "string" ? body.error : text.slice(0, 200);
      throw new ApiFail([401, 403, 404, 409, 413].includes(res.status) ? res.status : 502, HXOA_CODE, `hxoa ${res.status}: ${msg}`);
    }
    return body as T;
  }

  private async hello(base: string, token: string): Promise<HxoaHello> {
    const h = await this.call<Record<string, unknown>>(base, token, "/v1/hello", { ms: HELLO_MS });
    const s = (k: string) => (typeof h[k] === "string" ? (h[k] as string) : "");
    return {
      server: s("server"),
      workspace: s("workspace"),
      identity: s("identity"),
      root: s("root"),
      mode: s("mode"),
      ...(s("branch") ? { branch: s("branch") } : {}),
      ...(s("base_branch") ? { base: s("base_branch") } : {}),
      exec: h.exec === true,
    };
  }

  private async open(r: Row): Promise<string> {
    return unseal(this.secret, r.token);
  }

  /** 全部接入, 并行打一次 hello 看在不在线 (hxoa 面板也会因此显示在线)。 */
  async list(): Promise<HxoaConn[]> {
    return Promise.all(
      this.rows().map(async (r): Promise<HxoaConn> => {
        const c: HxoaConn = { id: r.id, name: r.name, base: r.base, at: r.at };
        try {
          return { ...c, hello: await this.hello(r.base, await this.open(r)) };
        } catch (e) {
          return { ...c, error: e instanceof Error ? e.message : String(e) };
        }
      }),
    );
  }

  /** 新接入: 先 hello 验证令牌能用, 再加密落库。 */
  async add(input: HxoaConnInput, now = Date.now()): Promise<HxoaConn> {
    if (this.rows().length >= HXOA_MAX_CONNS) throw new ApiFail(400, "bad_request", `最多 ${HXOA_MAX_CONNS} 条接入`);
    const hello = await this.hello(input.base, input.token);
    const id = hex(ID_BYTES);
    this.sql.exec("INSERT INTO hxoa_conn (id, name, base, token, at) VALUES (?, ?, ?, ?, ?)", id, input.name, input.base, await seal(this.secret, input.token), now);
    return { id, name: input.name, base: input.base, at: now, hello };
  }

  rename(id: string, name: string): void {
    this.row(id);
    this.sql.exec("UPDATE hxoa_conn SET name = ? WHERE id = ?", name, id);
  }

  /** 删掉接入 (只删 AIOA 这边的记录; hxoa 上的令牌要在 hxoa 面板删)。 */
  remove(id: string): boolean {
    return this.sql.exec("DELETE FROM hxoa_conn WHERE id = ?", id).rowsWritten > 0;
  }

  purge(): number {
    return this.sql.exec("DELETE FROM hxoa_conn").rowsWritten;
  }

  async ls(id: string, path: string, depth: number): Promise<HxoaLs> {
    const r = this.row(id);
    const q = new URLSearchParams({ path, depth: String(depth) });
    const b = await this.call<{ entries?: HxoaLs["entries"]; truncated?: boolean }>(r.base, await this.open(r), `/v1/ls?${q}`);
    return { entries: b.entries ?? [], ...(b.truncated ? { truncated: true } : {}) };
  }

  async read(id: string, path: string, start?: number, end?: number): Promise<HxoaRead> {
    const r = this.row(id);
    const q = new URLSearchParams({ path });
    if (start) q.set("start", String(start));
    if (end) q.set("end", String(end));
    const b = await this.call<Record<string, unknown>>(r.base, await this.open(r), `/v1/read?${q}`);
    const n = (k: string) => (typeof b[k] === "number" ? (b[k] as number) : 0);
    const [content] = cut(b.content);
    return { version: typeof b.version === "string" ? b.version : "", lines: n("lines"), start: n("start"), end: n("end"), content, ...(b.binary === true ? { binary: true } : {}) };
  }

  /** 新建文件夹 (hxoa 2.3.0 起有 /v1/mkdir, 旧版返回 404); created = false 表示原来就有。 */
  async mkdir(id: string, path: string): Promise<{ created: boolean }> {
    const r = this.row(id);
    const b = await this.call<{ created?: boolean }>(r.base, await this.open(r), "/v1/mkdir", { body: { path } });
    return { created: b.created === true };
  }

  async exec(id: string, input: HxoaExecInput): Promise<HxoaExec> {
    const r = this.row(id);
    const timeout = input.timeout ?? HXOA_EXEC_MAX_SEC;
    const b = await this.call<Record<string, unknown>>(r.base, await this.open(r), "/v1/exec", { body: { cmd: input.cmd, dir: input.dir, timeout }, ms: timeout * 1000 + EXEC_SLACK_MS });
    const [stdout, t1] = cut(b.stdout);
    const [stderr, t2] = cut(b.stderr);
    return {
      code: typeof b.code === "number" ? b.code : -1,
      stdout,
      stderr,
      ms: typeof b.ms === "number" ? b.ms : 0,
      ...(b.timed_out === true ? { timedOut: true } : {}),
      ...(t1 || t2 ? { truncated: true } : {}),
    };
  }
}
