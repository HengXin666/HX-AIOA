import { CLIENT_ANY, CLIENT_CAPS, CLIENT_KINDS, CLIENT_PERMS, CLIENT_POINTS, DEFAULT_CLIENTS, isBuild, isClientKind, type ClientDecl, type ClientKind } from "./client-caps";
import type { ItemType } from "./constants";
import { isExtPoint } from "./plugin-v2";
import type { PluginManifest } from "./plugin";
import { satisfies } from "./semver";
import type { Space } from "./space";

// 插件按端兼容 (#156): 清单字段校验, 端级别, 界面需求与能力表比对, 按端裁剪工作台
export const CLIENT_LEVELS = ["ok", "update", "unsupported"] as const;
export type ClientLevel = (typeof CLIENT_LEVELS)[number];
// update: 客户端构建号低于插件要求, need 是要更新到的构建号; unsupported: 插件没声明这个端, 或要求的构建号上限低于客户端
export type ClientFit = { level: ClientLevel; need?: number };

// 客户端构建号范围: 复用 semver.ts, 构建号 N 当作 N.0.0; 只允许 ">=N", "<N" 与 "*", 空格连接表示 "且"
const BUILD_TERM = /^(\*|(>=|<)\d{1,9})$/;
export const isBuildRange = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= 64 && v.trim().split(/\s+/).every((t) => BUILD_TERM.test(t));
/** 范围的最低构建号 (各 ">=N" 里最大的); 没有下界返回 0。 */
export const buildFloor = (range: string): number => Math.max(0, ...range.trim().split(/\s+/).filter((t) => t.startsWith(">=")).map((t) => Number(t.slice(2))));
export const buildIn = (build: number, range: string): boolean => satisfies(`${build}.0.0`, range);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const declList = (v: unknown): v is ClientDecl[] =>
  Array.isArray(v) && v.length > 0 && v.length <= CLIENT_KINDS.length && new Set(v).size === v.length && v.every((c) => c === CLIENT_ANY || isClientKind(c)) && (!v.includes(CLIENT_ANY) || v.length === 1);
const kindList = (v: unknown): v is ClientKind[] => Array.isArray(v) && v.length > 0 && v.length <= CLIENT_KINDS.length && new Set(v).size === v.length && v.every(isClientKind);
const KIND_HINT = `clients 只能写 ${CLIENT_KINDS.join(" / ")}`;

/** clients, engines.<端>, builtWith 与组件级 clients 的格式; 返回错误文字, 没问题返回 null。 */
export function clientFieldsError(raw: Record<string, unknown>): string | null {
  if (raw.clients !== undefined && !declList(raw.clients)) return `clients 是 ${CLIENT_KINDS.join(" / ")} 组成的数组, 或单独的 ["${CLIENT_ANY}"]`;
  const engines = isObj(raw.engines) ? raw.engines : {};
  for (const k of CLIENT_KINDS) if (engines[k] !== undefined && !isBuildRange(engines[k])) return `engines.${k} 是构建号范围, 如 ">=121" 或 ">=121 <200"`;
  if (raw.builtWith !== undefined) {
    if (!isObj(raw.builtWith)) return "builtWith 必须是对象";
    for (const [k, v] of Object.entries(raw.builtWith)) if (!isClientKind(k) || !isBuild(v)) return `builtWith 只能写 ${CLIENT_KINDS.join(" / ")} 的构建号 (正整数)`;
  }
  for (const [p, list] of Object.entries(isObj(raw.contributes) ? raw.contributes : {})) {
    for (const c of Array.isArray(list) ? list : []) if (isObj(c) && c.clients !== undefined && !kindList(c.clients)) return `${p}/${String(c.id)}: ${KIND_HINT}`;
  }
  const panels = isObj(raw.space) && Array.isArray(raw.space.panels) ? raw.space.panels : [];
  for (const p of panels) {
    if (!isObj(p)) continue;
    if (p.clients !== undefined && !kindList(p.clients)) return `space 面板 ${String(p.id)}: ${KIND_HINT}`;
    for (const it of Array.isArray(p.items) ? p.items : []) if (isObj(it) && it.clients !== undefined && !kindList(it.clients)) return `space 组件 ${String(it.id)}: ${KIND_HINT}`;
  }
  return null;
}

type ClientShape = Pick<PluginManifest, "clients" | "engines">;
export const clientsOf = (m: ClientShape): readonly ClientDecl[] => m.clients ?? DEFAULT_CLIENTS;
/** 声明的具体端; ["*"] (没有界面) 返回空。 */
export const kindsOf = (m: ClientShape): ClientKind[] => clientsOf(m).filter(isClientKind);

/** 插件在某端某构建号上的级别; 构建号不知道时只看端。 */
export function clientLevel(m: ClientShape, kind: ClientKind, build?: number): ClientFit {
  const decl = clientsOf(m);
  if (decl.includes(CLIENT_ANY)) return { level: "ok" };
  if (!decl.includes(kind)) return { level: "unsupported" };
  const range = m.engines?.[kind];
  if (!range || build === undefined || buildIn(build, range)) return { level: "ok" };
  const need = buildFloor(range);
  return build < need ? { level: "update", need } : { level: "unsupported" };
}

const shownOn = (kind: ClientKind, clients?: readonly ClientKind[]) => !clients || clients.includes(kind);

/** 按端裁掉写了 clients 且不含该端的面板与组件; 没有可裁的原样返回。 */
export function narrowSpace<T extends Space>(space: T, kind: ClientKind): T {
  const narrowed = space.panels.some((p) => !shownOn(kind, p.clients) || p.items.some((it) => !shownOn(kind, it.clients)));
  if (!narrowed) return space;
  return { ...space, panels: space.panels.filter((p) => shownOn(kind, p.clients)).map((p) => ({ ...p, items: p.items.filter((it) => shownOn(kind, it.clients)) })) };
}

export type UiNeed = { kind: "space" | "item" | "point" | "perm"; name: string };
const NEED_LABEL: Record<UiNeed["kind"], string> = { space: "工作台", item: "组件", point: "扩展点", perm: "权限" };
export const needLabel = (n: UiNeed): string => (n.kind === "space" ? NEED_LABEL.space : `${NEED_LABEL[n.kind]} ${n.name}`);

/** 插件在某端上要客户端支持的东西: 工作台与组件类型, 客户端渲染的扩展点, 客户端权限; 组件级 clients 不含该端的不算。 */
export function uiNeeds(m: Pick<PluginManifest, "space" | "contributes" | "permissions">, kind: ClientKind): UiNeed[] {
  const out: UiNeed[] = [];
  if (m.space) {
    const panels = narrowSpace(m.space, kind).panels;
    out.push({ kind: "space", name: "space" });
    for (const t of new Set(panels.flatMap((p) => p.items.map((it) => it.type)))) out.push({ kind: "item", name: t });
  }
  for (const [p, list] of Object.entries(m.contributes ?? {})) {
    if (isExtPoint(p) && CLIENT_POINTS.includes(p) && (list ?? []).some((c) => shownOn(kind, c.clients))) out.push({ kind: "point", name: p });
  }
  for (const p of m.permissions ?? []) if (CLIENT_PERMS.includes(p)) out.push({ kind: "perm", name: p });
  return out;
}

/** 某端某构建号上缺哪些能力 (按能力表)。 */
export function missingCaps(m: Pick<PluginManifest, "id" | "space" | "contributes" | "permissions">, kind: ClientKind, build: number): UiNeed[] {
  const caps = CLIENT_CAPS[kind];
  const native = caps.native[m.id];
  const since = (n: UiNeed): number | undefined => {
    if (n.kind === "space") return caps.space;
    if (n.kind === "item") return caps.items[n.name as ItemType];
    if (n.kind === "perm") return caps.perms[n.name];
    const generic = isExtPoint(n.name) ? caps.points[n.name] : undefined;
    return Math.min(generic ?? Infinity, native ?? Infinity);
  };
  return uiNeeds(m, kind).filter((n) => {
    const s = since(n);
    return s === undefined || !(s <= build);
  });
}
