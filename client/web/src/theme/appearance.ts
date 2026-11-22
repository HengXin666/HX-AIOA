import tokens from "../../../../design/tokens.json";
import { MIN_CONTRAST, SETTINGS_PATH, STORAGE_APPEARANCE, SYNC_DEBOUNCE_MS } from "../constants";
import { api, hasServer, json } from "../core/api";
import { alpha, contrast, ensureContrast, isHex, mix, onColor } from "./color";

export type Theme = "system" | "light" | "dark";
export type BgKind = "solid" | "gradient" | "image";
export type Density = "standard" | "compact";
export type Background = { kind: BgKind; color: string; from: string; to: string; image: string; dim: number };
export type Appearance = {
  theme: Theme;
  accent: string | null;
  background: Background;
  glass: { on: boolean; strength: number };
  radius: number;
  fontScale: number;
  density: Density;
};

type Palette = typeof tokens.color.light;
export const ACCENT_PRESETS: string[] = tokens.accentPresets;
const DARK_QUERY = "(prefers-color-scheme: dark)";

export function defaults(): Appearance {
  return {
    theme: "system",
    accent: null,
    background: { kind: "solid", color: "", from: "#E0E7FF", to: "#FCE7F3", image: "", dim: 0.3 },
    glass: { on: false, strength: 0.5 },
    radius: tokens.radius.md,
    fontScale: 1,
    density: "standard",
  };
}

export function isDark(a: Appearance): boolean {
  return a.theme === "dark" || (a.theme === "system" && window.matchMedia(DARK_QUERY).matches);
}

export function paletteOf(a: Appearance): Palette {
  return isDark(a) ? tokens.color.dark : tokens.color.light;
}

// 低端机, 省电或系统要求减少透明时自动关闭毛玻璃
export function glassAllowed(): boolean {
  const nav = navigator as Navigator & { connection?: { saveData?: boolean } };
  if (nav.connection?.saveData) return false;
  if ((navigator.hardwareConcurrency ?? 8) <= 2) return false;
  return !window.matchMedia("(prefers-reduced-transparency: reduce)").matches;
}

export type AccentInfo = { color: string; hover: string; press: string; soft: string; on: string; ratio: number; adjusted: boolean };

export function deriveAccent(a: Appearance): AccentInfo {
  const p = paletteOf(a);
  const raw = a.accent && isHex(a.accent) ? a.accent : p.accent;
  const color = ensureContrast(raw, p.background, p.text, MIN_CONTRAST);
  return {
    color,
    hover: mix(color, p.background, 0.12),
    press: mix(color, p.background, 0.24),
    soft: alpha(color, 0.12),
    on: onColor(color, tokens.color.light.text, tokens.color.light.background),
    ratio: contrast(raw, p.background),
    adjusted: color !== raw.toUpperCase(),
  };
}

function backgroundCss(a: Appearance, p: Palette): string {
  const b = a.background;
  if (b.kind === "gradient") return `linear-gradient(160deg, ${b.from}, ${b.to})`;
  if (b.kind === "image" && b.image) return `url("${b.image.replace(/"/g, "")}") center / cover no-repeat`;
  return b.color && isHex(b.color) ? b.color : p.background;
}

export function apply(a: Appearance): void {
  const root = document.documentElement;
  const p = paletteOf(a);
  const acc = deriveAccent(a);
  root.dataset.theme = a.theme;
  root.dataset.density = a.density;
  const glass = a.glass.on && glassAllowed();
  root.dataset.glass = glass ? "on" : "off";
  const vars: Record<string, string> = {
    "--color-accent": acc.color,
    "--color-on-accent": acc.on,
    "--accent-hover": acc.hover,
    "--accent-press": acc.press,
    "--accent-soft": acc.soft,
    "--radius-md": `${a.radius}px`,
    "--font-scale": String(a.fontScale),
    "--app-bg": backgroundCss(a, p),
    "--bg-dim": a.background.kind === "image" ? String(a.background.dim) : "0",
    "--glass-blur": `${Math.round(a.glass.strength * tokens.blur.lg)}px`,
    "--glass-alpha": String(0.55 + (1 - a.glass.strength) * 0.35),
  };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
}

export class AppearanceStore {
  value: Appearance;
  private listeners = new Set<() => void>();
  private timer: number | undefined;
  syncError: string | null = null;

  constructor() {
    this.value = load();
    window.matchMedia(DARK_QUERY).addEventListener("change", () => this.notify());
  }

  on(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  set(patch: Partial<Appearance>): void {
    this.value = { ...this.value, ...patch };
    localStorage.setItem(STORAGE_APPEARANCE, JSON.stringify(this.value));
    this.notify();
    this.scheduleSync();
  }

  reset(): void {
    this.set(defaults());
  }

  // 其它设备同步过来的设置, 不再回写服务端
  receive(remote: unknown): void {
    if (typeof remote !== "object" || remote === null) return;
    this.value = merge(remote as Partial<Appearance>);
    localStorage.setItem(STORAGE_APPEARANCE, JSON.stringify(this.value));
    this.notify();
  }

  private notify(): void {
    apply(this.value);
    this.listeners.forEach((fn) => fn());
  }

  private scheduleSync(): void {
    if (!hasServer()) return;
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      api(SETTINGS_PATH, json("PATCH", { appearance: this.value }))
        .then(() => (this.syncError = null))
        .catch((e: Error) => (this.syncError = e.message));
    }, SYNC_DEBOUNCE_MS);
  }
}

function merge(p: Partial<Appearance>): Appearance {
  const d = defaults();
  return {
    ...d,
    ...p,
    background: { ...d.background, ...(p.background ?? {}) },
    glass: { ...d.glass, ...(p.glass ?? {}) },
  };
}

function load(): Appearance {
  try {
    return merge(JSON.parse(localStorage.getItem(STORAGE_APPEARANCE) ?? "{}") as Partial<Appearance>);
  } catch {
    return defaults();
  }
}
