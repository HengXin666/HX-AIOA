import { MIN_CONTRAST, CLS } from "../constants";
import { button, h, icon } from "../core/dom";
import { ACCENT_PRESETS, deriveAccent, glassAllowed, type Appearance, type BgKind, type Density, type Theme } from "../theme/appearance";
import { isHex } from "../theme/color";
import { pageHead, type Env } from "./page";

const IMAGE_LIMIT = 1_500_000;

function segmented<T extends string>(opts: [T, string][], cur: T, pick: (v: T) => void): HTMLElement {
  return h("div", { class: "seg" }, ...opts.map(([v, t]) => h("button", { type: "button", class: v === cur ? "on" : "", onclick: () => pick(v) }, t)));
}

function slider(min: number, max: number, step: number, value: number, set: (v: number) => void): HTMLInputElement {
  const el = h("input", { type: "range", min, max, step, value });
  el.addEventListener("input", () => set(Number(el.value)));
  return el;
}

function row(label: string, ...controls: (HTMLElement | null)[]): HTMLElement {
  return h("div", { class: "set-row" }, h("span", { class: "set-label" }, label), h("div", { class: "set-ctl" }, ...controls));
}

function preview(): HTMLElement {
  return h(
    "section",
    { class: "card preview" },
    h("div", { class: "panel-head" }, icon("cpu"), h("strong", {}, "示例卡片"), h("span", { class: CLS.meta }, "实时预览")),
    h("div", { class: "big" }, h("span", { class: "num" }, "37.5"), h("span", { class: "unit" }, "%")),
    h("div", { class: "bar" }, h("i", { style: "width:62%" })),
    h("div", { class: "btn-row" }, h("button", { class: CLS.primary, type: "button" }, "主按钮"), h("button", { class: "btn", type: "button" }, "次按钮"), h("span", { class: "chip on" }, "选中")),
  );
}

// 外观设置: 改动即时生效并写入本地, 连上服务端时随账号同步
export function lookPage(root: HTMLElement, env: Env): void {
  const look = env.look;
  const body = h("div", {});
  const set = (p: Partial<Appearance>) => look.set(p);
  const draw = () => {
    const a = look.value;
    const acc = deriveAccent(a);
    const hex = h("input", { class: "input hex", value: a.accent ?? "", placeholder: "#2563EB" });
    hex.addEventListener("change", () => isHex(hex.value) && set({ accent: hex.value.startsWith("#") ? hex.value : `#${hex.value}` }));
    const picker = h("input", { type: "color", value: a.accent && isHex(a.accent) ? a.accent : "#2563EB" });
    picker.addEventListener("input", () => set({ accent: picker.value }));
    const contrastText = acc.ratio < MIN_CONTRAST
      ? `对比度 ${acc.ratio.toFixed(1)}:1, 偏低, 已自动加深为 ${acc.color}`
      : `对比度 ${acc.ratio.toFixed(1)}:1, 清晰可读`;
    const bg = a.background;
    const bgSet = (p: Partial<Appearance["background"]>) => set({ background: { ...bg, ...p } });
    const file = h("input", { type: "file", accept: "image/*" });
    file.addEventListener("change", () => {
      const f = file.files?.[0];
      if (!f) return;
      if (f.size > IMAGE_LIMIT) return void window.alert("图片过大, 请选择 1.5MB 以内的图片");
      const reader = new FileReader();
      reader.onload = () => bgSet({ kind: "image", image: String(reader.result) });
      reader.readAsDataURL(f);
    });
    const bgColor = h("input", { type: "color", value: bg.color && isHex(bg.color) ? bg.color : "#FFFFFF" });
    bgColor.addEventListener("input", () => bgSet({ color: bgColor.value }));
    const from = h("input", { type: "color", value: bg.from });
    from.addEventListener("input", () => bgSet({ from: from.value }));
    const to = h("input", { type: "color", value: bg.to });
    to.addEventListener("input", () => bgSet({ to: to.value }));
    const url = h("input", { class: "input", placeholder: "图片地址 https://...", value: bg.image.startsWith("data:") ? "" : bg.image });
    url.addEventListener("change", () => bgSet({ kind: "image", image: url.value.trim() }));
    const allowed = glassAllowed();

    body.replaceChildren(
      preview(),
      h(
        "div",
        { class: "card settings" },
        row("主题", segmented<Theme>([["system", "跟随系统"], ["light", "浅色"], ["dark", "深色"]], a.theme, (theme) => set({ theme }))),
        row(
          "主题色",
          h(
            "div",
            { class: "swatches" },
            h("button", { type: "button", class: `swatch auto${a.accent ? "" : " on"}`, title: "默认", onclick: () => set({ accent: null }) }, "默认"),
            ...ACCENT_PRESETS.map((c) => h("button", { type: "button", class: `swatch${a.accent === c ? " on" : ""}`, style: `background:${c}`, title: c, onclick: () => set({ accent: c }) })),
            picker,
            hex,
          ),
        ),
        h("div", { class: `meta${acc.ratio < MIN_CONTRAST ? " warn-text" : ""}` }, contrastText),
        row("背景", segmented<BgKind>([["solid", "纯色"], ["gradient", "渐变"], ["image", "图片"]], bg.kind, (kind) => bgSet({ kind }))),
        bg.kind === "solid" ? row("背景色", bgColor, button("跟随主题", () => bgSet({ color: "" }), CLS.ghostSm)) : null,
        bg.kind === "gradient" ? row("渐变", from, to) : null,
        bg.kind === "image" ? row("图片", url, file) : null,
        bg.kind === "image" ? row(`暗度 ${Math.round(bg.dim * 100)}%`, slider(0, 0.8, 0.05, bg.dim, (dim) => bgSet({ dim }))) : null,
        row(
          "毛玻璃",
          h("label", { class: "check" }, h("input", { type: "checkbox", checked: a.glass.on, onchange: () => set({ glass: { ...a.glass, on: !a.glass.on } }) }), a.glass.on ? "开" : "关"),
          slider(0.1, 1, 0.05, a.glass.strength, (strength) => set({ glass: { ...a.glass, strength } })),
        ),
        allowed ? null : h("div", { class: CLS.meta }, "当前设备或省电模式下已自动关闭毛玻璃"),
        row(`圆角 ${a.radius}px`, slider(0, 28, 2, a.radius, (radius) => set({ radius }))),
        row(`字号 ${Math.round(a.fontScale * 100)}%`, slider(0.85, 1.3, 0.05, a.fontScale, (fontScale) => set({ fontScale }))),
        row("卡片密度", segmented<Density>([["standard", "标准"], ["compact", "紧凑"]], a.density, (density) => set({ density }))),
        h("div", { class: "btn-row" }, button("恢复默认", () => look.reset(), "btn", "rotate-ccw")),
        look.syncError ? h("div", { class: "meta danger-text" }, `同步失败: ${look.syncError}`) : null,
      ),
    );
  };
  root.append(pageHead("外观", "改动即时生效, 随账号同步", "#/me"), body);
  // 拖动滑块或取色时不重建控件, 松手 (change) 再重绘
  const busy = () => ["range", "color"].includes((document.activeElement as HTMLInputElement | null)?.type ?? "");
  let frame = 0;
  env.scope.add(look.on(() => (busy() ? undefined : (frame ||= requestAnimationFrame(() => ((frame = 0), draw()))))));
  body.addEventListener("change", (e) => busy() && (e.target as HTMLInputElement).type !== "file" && draw());
  draw();
}
