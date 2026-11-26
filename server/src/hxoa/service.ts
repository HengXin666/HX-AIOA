import {
  HXOA_KIND_ADMIN,
  HXOA_KIND_AGENT,
  HXOA_MAX_CONNS,
  type HxoaBrowse,
  type HxoaConn,
  type HxoaConnInput,
  type HxoaHello,
  type HxoaNewToken,
  type HxoaState,
  type HxoaToken,
  type HxoaWorker,
  type HxoaWorkspace,
  type HxoaWsInput,
  type HxoaWsPatch,
} from "@hx-aioa/protocol";
import type { Env } from "../env";
import { seal, unseal } from "../gh/crypto";
import { ApiFail } from "../http";

export const HXOA_CODE = "hxoa";
// 连不上的 hxoa 不拖慢列表
const HELLO_MS = 5000;
const DEFAULT_MS = 20_000;
// 合并要跑 git, 多等一会儿
const MERGE_MS = 60_000;
const ID_BYTES = 6;
const ADMIN = "/admin/v1";
const LEGACY = "这是旧版存的工作区令牌, 管不了工作区。请删掉, 在 hxoa 面板 远程管理 里建管理令牌后重新接入 (需要 hxoa 2.4.0+)";

type Row = { id: string; name: string; base: string; token: string; at: number; kind: string };
type Obj = Record<string, unknown>;

const hex = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");
const str = (o: Obj, k: string) => (typeof o[k] === "string" ? (o[k] as string) : "");
const num = (o: Obj, k: string) => (typeof o[k] === "number" ? (o[k] as number) : 0);
const obj = (v: unknown): Obj => (typeof v === "object" && v !== null ? (v as Obj) : {});
// hxoa 的零值时间是 0001-01-01, 当作没有
const time = (o: Obj, k: string) => (str(o, k) && !str(o, k).startsWith("0001") ? { [k === "last_seen" ? "lastSeen" : k]: str(o, k) } : {});

function worker(v: unknown): HxoaWorker | undefined {
  if (v === undefined || v === null) return undefined;
  const w = obj(v);
  const dirty = Array.isArray(w.dirty) ? w.dirty.filter((d): d is string => typeof d === "string") : [];
  return { exists: w.exists === true, branch: str(w, "branch"), ...(str(w, "ahead") ? { ahead: str(w, "ahead") } : {}), ...(str(w, "behind") ? { behind: str(w, "behind") } : {}), ...(dirty.length ? { dirty } : {}) };
}

/** 连接令牌只留展示用字段, 密钥 (secret) 不出服务端。 */
export function toToken(v: unknown): HxoaToken {
  const t = obj(v);
  const w = worker(t.worker);
  return { id: str(t, "id"), label: str(t, "label"), online: t.online === true, ...time(t, "last_seen"), ...(str(t, "last_ip") ? { lastIp: str(t, "last_ip") } : {}), ops: num(t, "ops"), ...(w ? { worker: w } : {}) };
}

export function toState(v: Obj): HxoaState {
  const ws = Array.isArray(v.workspaces) ? v.workspaces : [];
  const tun = obj(v.tunnel);
  return {
    server: str(v, "server"),
    publicUrl: str(v, "public_url"),
    ...(str(tun, "mode") ? { tunnel: { mode: str(tun, "mode"), state: str(tun, "state"), ...(str(tun, "url") ? { url: str(tun, "url") } : {}), ...(str(tun, "error") ? { error: str(tun, "error") } : {}) } } : {}),
    workspaces: ws.map((raw): HxoaWorkspace => {
      const w = obj(raw);
      return {
        id: str(w, "id"),
        name: str(w, "name"),
        path: str(w, "path"),
        workers: w.workers === true,
        exec: w.exec === true,
        git: w.git === true,
        ...(str(w, "branch") ? { branch: str(w, "branch") } : {}),
        online: num(w, "online"),
        tokens: (Array.isArray(w.tokens) ? w.tokens : []).map(toToken),
      };
    }),
  };
}

/** hxoa 管理: 每条 = 名字 + 服务地址 + 管理令牌 (密文); 操作都由服务端带令牌转给 hxoa 的 /admin/v1/*。 */
export class HxoaService {
  constructor(
    private readonly env: Env,
    private readonly sql: SqlStorage,
  ) {
    sql.exec("CREATE TABLE IF NOT EXISTS hxoa_conn (id TEXT PRIMARY KEY, name TEXT NOT NULL, base TEXT NOT NULL, token TEXT NOT NULL, at INTEGER NOT NULL)");
    // #104: 旧行是工作区令牌 (agent), 新行是管理令牌 (admin)
    const cols = sql.exec<{ name: string }>("SELECT name FROM pragma_table_info('hxoa_conn')").toArray();
    if (!cols.some((c) => c.name === "kind")) sql.exec(`ALTER TABLE hxoa_conn ADD COLUMN kind TEXT NOT NULL DEFAULT '${HXOA_KIND_AGENT}'`);
  }

  private get secret(): string {
    return this.env.TOKEN_SECRET || this.env.AUTH_TOKEN;
  }

  private rows(): Row[] {
    return this.sql.exec<Row>("SELECT id, name, base, token, at, kind FROM hxoa_conn ORDER BY at").toArray();
  }

  private row(id: string): Row {
    const r = this.sql.exec<Row>("SELECT id, name, base, token, at, kind FROM hxoa_conn WHERE id = ?", id).toArray()[0];
    if (!r) throw new ApiFail(404, "not_found", "没有这条 hxoa 接入");
    if (r.kind !== HXOA_KIND_ADMIN) throw new ApiFail(409, HXOA_CODE, LEGACY);
    return r;
  }

  /** 带管理令牌调 hxoa; hxoa 的错误 ({error}) 原样带回, 401 说明管理令牌被删了。 */
  private async call(base: string, token: string, method: string, path: string, init: { body?: unknown; ms?: number } = {}): Promise<Obj> {
    let res: Response;
    try {
      res = await fetch(base + ADMIN + path, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(init.body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        signal: AbortSignal.timeout(init.ms ?? DEFAULT_MS),
      });
    } catch (e) {
      throw new ApiFail(502, HXOA_CODE, `连不上 hxoa: ${e instanceof Error ? e.message : String(e)}`);
    }
    const text = await res.text();
    let body: Obj | null = null;
    try {
      body = text ? (JSON.parse(text) as Obj) : null;
    } catch {
      body = null;
    }
    if (!res.ok || !body || body.ok === false) {
      const msg = body && typeof body.error === "string" ? body.error : text.slice(0, 200);
      const hint = res.status === 404 && !body ? " (hxoa 版本低于 2.4.0?)" : "";
      throw new ApiFail([400, 401, 403, 404, 409, 429].includes(res.status) ? res.status : 502, HXOA_CODE, `hxoa ${res.status}: ${msg}${hint}`);
    }
    return body;
  }

  private async go(id: string, method: string, path: string, init?: { body?: unknown; ms?: number }): Promise<Obj> {
    const r = this.row(id);
    return this.call(r.base, await unseal(this.secret, r.token), method, path, init);
  }

  private async hello(base: string, token: string): Promise<HxoaHello> {
    const h = await this.call(base, token, "GET", "/hello", { ms: HELLO_MS });
    return { server: str(h, "server"), admin: str(h, "admin"), publicUrl: str(h, "public_url") };
  }

  /** 全部接入, 并行打一次 hello 看在不在线; 旧版工作区令牌不去连, 直接提示重接。 */
  async list(): Promise<HxoaConn[]> {
    return Promise.all(
      this.rows().map(async (r): Promise<HxoaConn> => {
        const c: HxoaConn = { id: r.id, name: r.name, base: r.base, at: r.at, kind: r.kind };
        if (r.kind !== HXOA_KIND_ADMIN) return { ...c, error: LEGACY };
        try {
          return { ...c, hello: await this.hello(r.base, await unseal(this.secret, r.token)) };
        } catch (e) {
          return { ...c, error: e instanceof Error ? e.message : String(e) };
        }
      }),
    );
  }

  /** 新接入: 先 hello 验证管理令牌能用, 再加密落库。 */
  async add(input: HxoaConnInput, now = Date.now()): Promise<HxoaConn> {
    if (this.rows().length >= HXOA_MAX_CONNS) throw new ApiFail(400, "bad_request", `最多 ${HXOA_MAX_CONNS} 条接入`);
    const hello = await this.hello(input.base, input.token);
    const id = hex(ID_BYTES);
    this.sql.exec("INSERT INTO hxoa_conn (id, name, base, token, at, kind) VALUES (?, ?, ?, ?, ?, ?)", id, input.name, input.base, await seal(this.secret, input.token), now, HXOA_KIND_ADMIN);
    return { id, name: input.name, base: input.base, at: now, kind: HXOA_KIND_ADMIN, hello };
  }

  rename(id: string, name: string): void {
    if (!this.sql.exec("SELECT id FROM hxoa_conn WHERE id = ?", id).toArray().length) throw new ApiFail(404, "not_found", "没有这条 hxoa 接入");
    this.sql.exec("UPDATE hxoa_conn SET name = ? WHERE id = ?", name, id);
  }

  /** 删掉接入 (只删 AIOA 这边的记录; 管理令牌要在 hxoa 面板删)。旧版行也能删。 */
  remove(id: string): boolean {
    return this.sql.exec("DELETE FROM hxoa_conn WHERE id = ?", id).rowsWritten > 0;
  }

  purge(): number {
    return this.sql.exec("DELETE FROM hxoa_conn").rowsWritten;
  }

  async state(id: string): Promise<HxoaState> {
    return toState(await this.go(id, "GET", "/state"));
  }

  async browse(id: string, path: string): Promise<HxoaBrowse> {
    const b = await this.go(id, "GET", `/browse?${new URLSearchParams({ path })}`);
    return { path: str(b, "path"), parent: str(b, "parent"), dirs: Array.isArray(b.dirs) ? b.dirs.filter((d): d is string => typeof d === "string") : [], git: b.git === true };
  }

  async mkdir(id: string, parent: string, name: string): Promise<{ path: string }> {
    return { path: str(await this.go(id, "POST", "/mkdir", { body: { parent, name } }), "path") };
  }

  async addWorkspace(id: string, input: HxoaWsInput): Promise<{ id: string }> {
    const b = await this.go(id, "POST", "/workspaces", { body: input });
    return { id: str(obj(b.workspace), "id") };
  }

  async patchWorkspace(id: string, ws: string, patch: HxoaWsPatch): Promise<void> {
    await this.go(id, "PATCH", `/workspaces/${ws}`, { body: patch });
  }

  async deleteWorkspace(id: string, ws: string): Promise<void> {
    await this.go(id, "DELETE", `/workspaces/${ws}`);
  }

  async addToken(id: string, ws: string, label: string): Promise<HxoaNewToken> {
    const b = await this.go(id, "POST", `/workspaces/${ws}/tokens`, { body: { label } });
    return { token: toToken(b.token), prompt: str(b, "prompt") };
  }

  async prompt(id: string, tok: string): Promise<{ prompt: string }> {
    return { prompt: str(await this.go(id, "GET", `/tokens/${tok}/prompt`), "prompt") };
  }

  async deleteToken(id: string, tok: string): Promise<void> {
    await this.go(id, "DELETE", `/tokens/${tok}`);
  }

  async merge(id: string, tok: string): Promise<{ output: string }> {
    return { output: str(await this.go(id, "POST", `/tokens/${tok}/merge`, { ms: MERGE_MS }), "output") };
  }
}
