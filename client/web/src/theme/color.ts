type Rgb = [number, number, number];

export function parseHex(hex: string): Rgb | null {
  const m = hex.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  let s = m[1]!;
  if (s.length === 3) s = [...s].map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)) as Rgb;
}

export const isHex = (hex: string) => parseHex(hex) !== null;

export function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

export function mix(a: string, b: string, t: number): string {
  const x = parseHex(a) ?? [0, 0, 0];
  const y = parseHex(b) ?? [0, 0, 0];
  return toHex([0, 1, 2].map((i) => x[i]! + (y[i]! - x[i]!) * t) as Rgb);
}

export function alpha(hex: string, a: number): string {
  const [r, g, b] = parseHex(hex) ?? [0, 0, 0];
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function luminance(hex: string): number {
  const rgb = parseHex(hex) ?? [0, 0, 0];
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// WCAG 对比度, 1 到 21
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

export function onColor(bg: string, dark: string, light: string): string {
  return contrast(bg, dark) >= contrast(bg, light) ? dark : light;
}

// 对比不足时向文字色靠拢, 保证强调色在当前背景上看得清
export function ensureContrast(fg: string, bg: string, toward: string, min: number): string {
  let out = fg;
  for (let t = 0.1; contrast(out, bg) < min && t <= 1; t += 0.1) out = mix(fg, toward, t);
  return out;
}
