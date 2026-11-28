#!/usr/bin/env node
// 由 design/tokens.json 生成安卓 Kotlin 令牌; Web 端 (#155) 直接用 HX-UI 2 的令牌, 不再生成 CSS
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "design", "tokens.json");
const KT_OUT = join(ROOT, "client", "android", "ui", "src", "commonMain", "kotlin", "com", "hengxin", "aioa", "kit", "GeneratedTokens.kt");
const HEADER = "由 tools/gen-tokens.mjs 生成, 请勿手改, 改 design/tokens.json";

const t = JSON.parse(readFileSync(SRC, "utf8"));
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

mkdirSync(dirname(KT_OUT), { recursive: true });
writeFileSync(KT_OUT, kotlin());
console.log("已生成: GeneratedTokens.kt");
