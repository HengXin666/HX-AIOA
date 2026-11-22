#!/usr/bin/env node
// 由 design/tokens.json 生成 Web CSS 变量与安卓 Kotlin 令牌, 两端只改 json
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "design", "tokens.json");
const CSS_OUT = join(ROOT, "client", "web", "src", "tokens.css");
const KT_OUT = join(ROOT, "client", "android", "ui", "src", "commonMain", "kotlin", "com", "hengxin", "aioa", "kit", "GeneratedTokens.kt");
const HEADER = "由 tools/gen-tokens.mjs 生成, 请勿手改, 改 design/tokens.json";

const t = JSON.parse(readFileSync(SRC, "utf8"));
const kebab = (s) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const px = (n) => `${n}px`;

function vars(prefix, obj, fmt = (v) => v) {
  return Object.entries(obj).map(([k, v]) => `  --${prefix}-${kebab(k)}: ${fmt(v)};`);
}

function css() {
  const base = [
    ...vars("color", t.color.light),
    ...vars("radius", t.radius, px),
    ...vars("shadow", t.shadow),
    `  --font-family: ${t.font.family};`,
    `  --font-mono: ${t.font.mono};`,
    ...vars("font-size", t.font.size, px),
    ...vars("font-weight", t.font.weight),
    ...vars("space", t.spacing, px),
    ...vars("blur", t.blur, px),
    `  --gap: ${px(t.density.standard.gap)};`,
    `  --pad: ${px(t.density.standard.padding)};`,
  ];
  const dark = vars("color", t.color.dark).map((l) => `  ${l}`);
  return [
    `/* ${HEADER} */`,
    `:root {\n${base.join("\n")}\n  color-scheme: light;\n}`,
    `:root[data-theme="dark"] {\n${vars("color", t.color.dark).join("\n")}\n  color-scheme: dark;\n}`,
    `@media (prefers-color-scheme: dark) {\n  :root[data-theme="system"] {\n${dark.join("\n")}\n    color-scheme: dark;\n  }\n}`,
    `:root[data-density="compact"] {\n  --gap: ${px(t.density.compact.gap)};\n  --pad: ${px(t.density.compact.padding)};\n}`,
    "",
  ].join("\n\n");
}

const ktColor = (hex) => `Color(0xFF${hex.replace("#", "").toUpperCase()})`;

function ktColors(name, obj) {
  const rows = Object.entries(obj).map(([k, v]) => `        ${k} = ${ktColor(v)},`);
  return `    val ${name} = AioaColors(\n${rows.join("\n")}\n    )`;
}

function ktNumbers(name, obj, unit = "dp") {
  const rows = Object.entries(obj).map(([k, v]) => `        val ${k} = ${v}.${unit}`);
  return `    object ${name} {\n${rows.join("\n")}\n    }`;
}

function kotlin() {
  const presets = t.accentPresets.map(ktColor).join(", ");
  return [
    "package com.hengxin.aioa.kit",
    "",
    "import androidx.compose.ui.graphics.Color",
    "import androidx.compose.ui.unit.dp",
    "import androidx.compose.ui.unit.sp",
    "",
    `/** ${HEADER}。 */`,
    "object GeneratedTokens {",
    ktColors("light", t.color.light),
    ktColors("dark", t.color.dark),
    `    val accentPresets = listOf(${presets})`,
    ktNumbers("Radius", t.radius),
    ktNumbers("Spacing", t.spacing),
    ktNumbers("Blur", t.blur),
    ktNumbers("FontSize", t.font.size, "sp"),
    `    val standard = AioaMetrics(radius = Radius.md, gap = ${t.density.standard.gap}.dp, padding = ${t.density.standard.padding}.dp)`,
    `    val compact = AioaMetrics(radius = Radius.md, gap = ${t.density.compact.gap}.dp, padding = ${t.density.compact.padding}.dp)`,
    "}",
    "",
  ].join("\n");
}

writeFileSync(CSS_OUT, css());
mkdirSync(dirname(KT_OUT), { recursive: true });
writeFileSync(KT_OUT, kotlin());
console.log("已生成: client/web/src/tokens.css, GeneratedTokens.kt");
