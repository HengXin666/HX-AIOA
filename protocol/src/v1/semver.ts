// 最小 semver: 只认 x.y.z (可带 -预发布), 范围支持 *, x, ^, ~, >=, <, 精确值, 以及空格连接的 "且"
export type Ver = [number, number, number];

const VER_RE = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-[\w.]+)?$/;

export function parseVer(s: string): Ver | null {
  const m = VER_RE.exec(s.trim());
  return m ? [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)] : null;
}

export const isVersion = (s: unknown): s is string => typeof s === "string" && /^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(s);

export function cmpVer(a: Ver, b: Ver): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}

// 一个比较子: 返回 [下界含, 上界不含]; 无上界用 null
function bounds(term: string): [Ver, Ver | null] | null {
  const t = term.trim();
  if (t === "*" || t === "") return [[0, 0, 0], null];
  const op = /^(\^|~|>=|<|=)?(.*)$/.exec(t)!;
  const raw = op[2]!.trim();
  const v = parseVer(raw);
  if (!v) return null;
  const parts = raw.replace(/^v/, "").split("-")[0]!.split(".").length;
  switch (op[1]) {
    case ">=":
      return [v, null];
    case "<":
      return [[0, 0, 0], v];
    case "~":
      return [v, parts === 1 ? [v[0] + 1, 0, 0] : [v[0], v[1] + 1, 0]];
    case "^":
      if (v[0] > 0 || parts === 1) return [v, [v[0] + 1, 0, 0]];
      if (v[1] > 0 || parts === 2) return [v, [0, v[1] + 1, 0]];
      return [v, [0, 0, v[2] + 1]];
    default:
      if (parts === 1) return [v, [v[0] + 1, 0, 0]];
      if (parts === 2) return [v, [v[0], v[1] + 1, 0]];
      return [v, [v[0], v[1], v[2] + 1]];
  }
}

export const isRange = (s: unknown): s is string => typeof s === "string" && s.length <= 64 && s.split(/\s+/).every((t) => bounds(t) !== null);

/** version 是否落在 range 里; 任一方写错都算不满足。 */
export function satisfies(version: string, range: string): boolean {
  const v = parseVer(version);
  if (!v) return false;
  return range
    .trim()
    .split(/\s+/)
    .every((t) => {
      const b = bounds(t);
      return !!b && cmpVer(v, b[0]) >= 0 && (b[1] === null || cmpVer(v, b[1]) < 0);
    });
}
