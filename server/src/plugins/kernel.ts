import {
  PLUGIN_DAILY_BUDGET,
  PROTOCOL_VERSION,
  SERVICE_PREFIX,
  cardOf,
  checkPlugins,
  isExtPoint,
  isRisky,
  type CheckResult,
  type Contribution,
  type ExtPoint,
  type PluginAllow,
  type PluginManifest,
} from "@hx-aioa/protocol";
import type { AllowRow, AllowStore } from "./allow-store";

export const HOST_ENGINE = `${PROTOCOL_VERSION}.0.0`;
const DEV_FLAG = "dev:";
export type Entry = { plugin: string; c: Contribution };
export type Listener = (uid: string, payload: unknown, from: string) => void;
type Undo = () => void;

/**
 * 插件运行时内核: 白名单, 账号启用, 扩展点注册表, 服务表, 事件总线, 全在 Hub 内存里。
 * 启用判断只查内存 Set, 不查库, 不多一次 DO 请求; 撤销放行按插件撤销它的全部注册。
 */
export class PluginKernel {
  private loaded = false;
  private readonly allow = new Map<string, AllowRow>();
  private readonly enabled = new Map<string, Set<string>>();
  private readonly choice = new Map<string, Map<string, string>>();
  private readonly points = new Map<ExtPoint, Entry[]>();
  private readonly services = new Map<string, { plugin: string; version: string }[]>();
  private readonly listeners = new Map<string, { plugin: string; fn: Listener }[]>();
  private readonly undo = new Map<string, Undo[]>();

  // seed: 白名单还是空的时候, 把升级前已安装的插件放进白名单并为主人启用 (只跑一次)
  // builtins: 内置 (L2a) 插件各自的一次性迁移, 返回是否写了白名单
  constructor(
    private readonly store: AllowStore,
    private readonly seed?: () => { rows: AllowRow[]; uid: string },
    private readonly builtins?: () => boolean,
  ) {}

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    let rows = this.store.allows();
    if (this.seed && !this.store.seeded()) {
      if (!rows.length) {
        const s = this.seed();
        for (const row of s.rows) {
          this.store.putAllow(row);
          this.store.setEnabled(s.uid, row.meta.id, true);
        }
        rows = s.rows;
      }
      this.store.markSeeded();
    }
    if (this.builtins?.()) rows = this.store.allows();
    for (const row of rows) this.register(row);
    for (const e of this.store.enables()) if (this.allow.has(e.id)) this.setOf(e.uid).add(e.id);
    for (const c of this.store.choices()) this.choicesOf(c.uid).set(c.point, c.plugin);
  }

  private setOf(uid: string): Set<string> {
    let s = this.enabled.get(uid);
    if (!s) this.enabled.set(uid, (s = new Set()));
    return s;
  }

  private choicesOf(uid: string): Map<string, string> {
    let m = this.choice.get(uid);
    if (!m) this.choice.set(uid, (m = new Map()));
    return m;
  }

  private track(plugin: string, fn: Undo): void {
    this.undo.set(plugin, [...(this.undo.get(plugin) ?? []), fn]);
  }

  private register(row: AllowRow): void {
    const id = row.meta.id;
    this.allow.set(id, row);
    for (const [p, list] of Object.entries(row.manifest.contributes ?? {})) {
      if (!isExtPoint(p)) continue;
      const mine = (list ?? []).map((c) => ({ plugin: id, c }));
      this.points.set(p, [...(this.points.get(p) ?? []), ...mine]);
      this.track(id, () => this.points.set(p, (this.points.get(p) ?? []).filter((e) => e.plugin !== id)));
    }
    for (const [s, version] of Object.entries(row.manifest.provides ?? {})) {
      this.services.set(s, [...(this.services.get(s) ?? []), { plugin: id, version }]);
      this.track(id, () => this.services.set(s, (this.services.get(s) ?? []).filter((x) => x.plugin !== id)));
    }
  }

  private unregister(id: string): void {
    for (const fn of this.undo.get(id) ?? []) fn();
    this.undo.delete(id);
    this.allow.delete(id);
  }

  list(): PluginAllow[] {
    this.load();
    return [...this.allow.values()].map((r) => r.meta);
  }

  get(id: string): AllowRow | undefined {
    this.load();
    return this.allow.get(id);
  }

  /** 这个账号看得到的白名单: 别人的开发插件不算; all 为真 (主人) 时全给, 方便清理。 */
  visible(uid: string | null, all = false): PluginAllow[] {
    return this.list().filter((a) => all || !a.dev || a.by === uid);
  }

  // 不是别人的开发插件 (不查库)
  private mine(uid: string, id: string): boolean {
    const m = this.allow.get(id)?.meta;
    return !!m && (!m.dev || m.by === uid);
  }

  /** 这个账号能不能用 (启用, 改选): 已放行, 且不是别人的开发插件; 开发插件还要开发者仍开着开发模式。 */
  usable(uid: string, id: string): boolean {
    this.load();
    if (!this.mine(uid, id)) return false;
    return !this.allow.get(id)!.meta.dev || this.devMode(uid);
  }

  /** 开发模式开关存在 flag 表里, 只在开发接口用到时读。 */
  devMode(uid: string): boolean {
    return this.store.flag(DEV_FLAG + uid);
  }

  setDevMode(uid: string, on: boolean): void {
    if (on) this.store.setFlag(DEV_FLAG + uid);
    else this.store.clearFlag(DEV_FLAG + uid);
  }

  /** 把 next 换进白名单 (或去掉 drop) 后整体能否共存 (不写入)。 */
  check(next?: AllowRow, drop?: string): CheckResult {
    this.load();
    // 开发插件只影响开发者自己, 不参与别人的冲突与预算; 检查开发插件时带上同一开发者的其它开发插件
    const dev = next?.meta.dev ? next.meta.by : null;
    const rows = new Map([...this.allow].filter(([, r]) => !r.meta.dev || r.meta.by === dev));
    if (next) rows.set(next.meta.id, next);
    if (drop) rows.delete(drop);
    const defaults: Record<string, string> = {};
    for (const r of rows.values()) for (const d of r.meta.defaults ?? []) defaults[d] = r.meta.id;
    return checkPlugins(
      [...rows.values()].map((r) => r.manifest),
      { engine: HOST_ENGINE, defaults, budget: PLUGIN_DAILY_BUDGET },
    );
  }

  /** 放行或换版本: 先撤销旧注册再按新清单注册, 账号启用状态保留。 */
  put(row: AllowRow): void {
    this.load();
    const risky = (row.manifest.permissions ?? []).filter(isRisky);
    const meta: PluginAllow = { ...row.meta, ...(risky.length ? { risky } : {}) };
    const next = { ...row, meta };
    for (const d of meta.defaults ?? []) {
      for (const other of this.allow.values()) {
        if (other.meta.id === meta.id || !other.meta.defaults?.includes(d)) continue;
        const o = { ...other, meta: { ...other.meta, defaults: other.meta.defaults.filter((x) => x !== d) } };
        this.store.putAllow(o);
        this.allow.set(o.meta.id, o);
      }
    }
    this.store.putAllow(next);
    this.unregister(meta.id);
    this.register(next);
  }

  /** 撤销放行: 返回原先启用了它的账号。 */
  revoke(id: string): string[] {
    this.load();
    const had = [...this.enabled].filter(([, s]) => s.has(id)).map(([uid]) => uid);
    this.store.dropAllow(id);
    this.unregister(id);
    for (const uid of had) this.enabled.get(uid)?.delete(id);
    for (const m of this.choice.values()) for (const [p, v] of m) if (v === id) m.delete(p);
    for (const [ev, list] of this.listeners) this.listeners.set(ev, list.filter((l) => l.plugin !== id));
    return had;
  }

  isEnabled(uid: string, id: string): boolean {
    this.load();
    return this.allow.has(id) && (this.enabled.get(uid)?.has(id) ?? false);
  }

  enabledOf(uid: string): string[] {
    this.load();
    return [...(this.enabled.get(uid) ?? [])].filter((id) => this.allow.has(id));
  }

  /** 账号启用 / 停用; 没放行的不让开。返回是否有变化。 */
  setEnabled(uid: string, id: string, on: boolean): boolean {
    this.load();
    if (on && !this.usable(uid, id)) return false;
    const s = this.setOf(uid);
    if (s.has(id) === on) return false;
    this.store.setEnabled(uid, id, on);
    if (on) s.add(id);
    else {
      s.delete(id);
      const m = this.choicesOf(uid);
      for (const [p, v] of m) if (v === id) m.delete(p);
    }
    return true;
  }

  choicesFor(uid: string): Record<string, string> {
    this.load();
    return Object.fromEntries(this.choice.get(uid) ?? []);
  }

  /** 账号在单选扩展点或服务上改选; 只能选白名单里且自己启用了的提供者, null 回到管理员默认。 */
  choose(uid: string, point: string, plugin: string | null): string | null {
    this.load();
    const cands = this.candidates(point);
    if (!cands) return `${point} 不是单选扩展点或服务`;
    if (plugin && !(cands.includes(plugin) && this.isEnabled(uid, plugin))) return `${plugin} 不提供 ${point} 或没启用`;
    this.store.setChoice(uid, point, plugin);
    if (plugin) this.choicesOf(uid).set(point, plugin);
    else this.choicesOf(uid).delete(point);
    return null;
  }

  private candidates(point: string): string[] | null {
    if (point.startsWith(SERVICE_PREFIX)) return (this.services.get(point) ?? []).map((x) => x.plugin);
    if (!isExtPoint(point) || cardOf(point) !== "single") return null;
    return [...new Set((this.points.get(point) ?? []).map((e) => e.plugin))];
  }

  private pick(uid: string, point: string): string | undefined {
    const cands = (this.candidates(point) ?? []).filter((p) => this.isEnabled(uid, p));
    const mine = this.choice.get(uid)?.get(point);
    if (mine && cands.includes(mine)) return mine;
    const def = cands.find((p) => this.allow.get(p)?.meta.defaults?.includes(point));
    return def ?? (cands.length === 1 ? cands[0] : undefined);
  }

  /** 这个账号在某扩展点上实际生效的贡献: single 裁决出一个, pipeline 按 before/after 排好。 */
  contributions(uid: string, point: ExtPoint): Entry[] {
    this.load();
    const all = this.points.get(point) ?? [];
    const card = cardOf(point);
    if (card === "single") {
      const p = this.pick(uid, point);
      return all.filter((e) => e.plugin === p);
    }
    // pipeline 先在这个账号看得到的全集上排序再过滤, 中间某个没启用也不丢传递的先后; 别人的开发插件不参与排序
    const seen = all.filter((e) => this.mine(uid, e.plugin));
    return (card === "pipeline" ? ordered(seen) : seen).filter((e) => this.isEnabled(uid, e.plugin));
  }

  /** 这个账号上某服务由哪个插件提供。 */
  service(uid: string, name: string): string | undefined {
    this.load();
    return this.pick(uid, name);
  }

  /** 进程内插件 (L2a) 订阅事件; 必须在清单 listens 里声明。返回撤销函数。 */
  on(plugin: string, event: string, fn: Listener): Undo | null {
    this.load();
    if (!this.allow.get(plugin)?.manifest.listens?.includes(event)) return null;
    const entry = { plugin, fn };
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), entry]);
    // 不挂进 undo: 换版本时监听保留, 只在撤销放行时清掉
    return () => this.listeners.set(event, (this.listeners.get(event) ?? []).filter((l) => l !== entry));
  }

  /** 只在内存分发, 至多一次, 不落库; 只发给该账号启用了的监听者。返回送达个数, 没声明 emits 返回 -1。 */
  emit(uid: string, from: string, event: string, payload: unknown): number {
    this.load();
    if (!this.isEnabled(uid, from) || !this.allow.get(from)?.manifest.emits?.includes(event)) return -1;
    let n = 0;
    for (const l of this.listeners.get(event) ?? []) {
      if (!this.isEnabled(uid, l.plugin)) continue;
      try {
        l.fn(uid, payload, from);
        n += 1;
      } catch (e) {
        console.error(`插件 ${l.plugin} 处理 ${event} 出错:`, e);
      }
    }
    return n;
  }
}

/** pipeline 拓扑排序; 成环的在放行时已被拦下, 这里遇到就按原顺序兜底。 */
export function ordered(list: Entry[]): Entry[] {
  const ids = new Map(list.map((e) => [e.c.id, e]));
  const indeg = new Map(list.map((e) => [e.c.id, 0]));
  const next = new Map(list.map((e) => [e.c.id, [] as string[]]));
  const edge = (a: string, b: string) => {
    if (!ids.has(a) || !ids.has(b)) return;
    next.get(a)!.push(b);
    indeg.set(b, indeg.get(b)! + 1);
  };
  for (const { c } of list) {
    for (const b of c.before ?? []) edge(c.id, b);
    for (const a of c.after ?? []) edge(a, c.id);
  }
  const queue = list.filter((e) => indeg.get(e.c.id) === 0).map((e) => e.c.id);
  const out: Entry[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    out.push(ids.get(id)!);
    for (const b of next.get(id)!) {
      indeg.set(b, indeg.get(b)! - 1);
      if (indeg.get(b) === 0) queue.push(b);
    }
  }
  return out.length === list.length ? out : list;
}
