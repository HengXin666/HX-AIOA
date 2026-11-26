#!/usr/bin/env node
// 由锁定版本的 HX-UI 令牌与组件清单生成安卓 Kotlin (HxUiTokens.kt, HxVariants.kt)。
//   node tools/hx-ui-gen.mjs           生成
//   node tools/hx-ui-gen.mjs --check   只校验: 锁文件哈希与 design/hx-ui/ 一致, 生成物是最新的 (CI 用)
//   node tools/hx-ui-gen.mjs --sync 2.3.0   从 HX-UI 的 GitHub Release 取该版本的两个文件, 更新锁再生成
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "design", "hx-ui");
const LOCK = join(ROOT, "design", "hx-ui.lock.json");
const KIT = join(ROOT, "client", "android", "ui", "src", "commonMain", "kotlin", "com", "hengxin", "aioa", "kit");
const TOKENS_KT = join(KIT, "HxUiTokens.kt");
const VARIANTS_KT = join(KIT, "HxVariants.kt");
const FILES = ["tokens.json", "components.json"];
const RELEASE = (v) => `https://github.com/HengXin666/HX-UI/releases/download/v${v}/hx-ui-${v}.tgz`;
const HEADER = "由 tools/hx-ui-gen.mjs 从 design/hx-ui/ (HX-UI 锁定版本) 生成, 请勿手改";

const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const camel = (s) => s.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
const pascal = (s) => camel(s).replace(/^./, (c) => c.toUpperCase());
// Kotlin 标识符不能以数字开头: 2xl -> X2l
const ident = (s) => (/^\d/.test(s) ? `X${s}` : camel(s));
const ktColor = (hex) => {
  const h = hex.replace("#", "").toUpperCase();
  const rgb = h.slice(0, 6);
  const a = h.length === 8 ? h.slice(6) : "FF";
  return `Color(0x${a}${rgb})`;
};

function sync(version) {
  const tmp = mkdtempSync(join(tmpdir(), "hx-ui-"));
  const tgz = join(tmp, "pkg.tgz");
  execFileSync("curl", ["-fsSL", "-o", tgz, RELEASE(version)], { stdio: "inherit" });
  execFileSync("tar", ["-xzf", tgz, "-C", tmp]);
  mkdirSync(DIR, { recursive: true });
  for (const f of FILES) writeFileSync(join(DIR, f), readFileSync(join(tmp, "package", "dist", f)));
  const lock = JSON.parse(readFileSync(LOCK, "utf8"));
  writeFileSync(LOCK, JSON.stringify({ ...lock, version, source: RELEASE(version) }, null, 2) + "\n");
}

function palette(name, colors) {
  const rows = Object.entries(colors).map(([k, v]) => `        ${camel(k)} = ${ktColor(v)},`);
  return `    val ${name} = HxPalette(\n${rows.join("\n")}\n    )`;
}

function tokensKt(t, skin) {
  const s = t.skins[skin];
  if (!s) throw new Error(`HX-UI ${t.version} 没有皮肤 ${skin}`);
  const keys = Object.keys(s.light);
  const fields = keys.map((k) => `    val ${camel(k)}: Color,`);
  const radius = Object.entries(t.radius).map(([k, v]) => `        val ${ident(k)} = ${v}.dp`);
  const dur = Object.entries(t.motion.duration).map(([k, v]) => `        const val ${ident(k)} = ${v}`);
  const ease = Object.entries(t.motion.easing).map(([k, v]) => `        val ${ident(k)} = CubicBezierEasing(${v.map((x) => `${x}f`).join(", ")})`);
  return [
    "package com.hengxin.aioa.kit",
    "",
    "import androidx.compose.animation.core.CubicBezierEasing",
    "import androidx.compose.runtime.Immutable",
    "import androidx.compose.ui.graphics.Color",
    "import androidx.compose.ui.unit.dp",
    "",
    `// ${HEADER}`,
    "",
    "/** HX-UI 的一套语义色 (与 shadcn 变量同名, 驼峰)。 */",
    "@Immutable",
    "data class HxPalette(",
    ...fields,
    ")",
    "",
    `/** HX-UI ${t.version}, 皮肤 ${skin}。 */`,
    "object HxUi {",
    `    const val VERSION = "${t.version}"`,
    `    const val SKIN = "${skin}"`,
    palette("light", s.light),
    palette("dark", s.dark),
    "    object Radius {",
    ...radius,
    "    }",
    "    object Duration {",
    ...dur,
    "    }",
    "    object Easing {",
    ...ease,
    "    }",
    "}",
    "",
  ].join("\n");
}

function variantsKt(c) {
  const out = ["package com.hengxin.aioa.kit", "", `// ${HEADER}`, "// HX-UI 新增变体时这里多出枚举值, 用到它的 when 不再穷尽, 编译就会提醒补实现。", ""];
  for (const [comp, def] of Object.entries(c.components)) {
    for (const [axis, values] of Object.entries(def)) {
      if (axis === "default") continue;
      out.push(`/** HX-UI ${comp} 的 ${axis}。 */`);
      out.push(`enum class Hx${pascal(comp)}${pascal(axis)}(val key: String) {`);
      out.push(...values.map((v) => `    ${pascal(v.replace(/^(\d)/, "X$1"))}("${v}"),`));
      out.push("}", "");
    }
  }
  return out.join("\n");
}

function render(lock) {
  const t = JSON.parse(readFileSync(join(DIR, "tokens.json"), "utf8"));
  const c = JSON.parse(readFileSync(join(DIR, "components.json"), "utf8"));
  if (t.version !== lock.version) throw new Error(`design/hx-ui/tokens.json 是 ${t.version}, 锁定的是 ${lock.version}`);
  return { [TOKENS_KT]: tokensKt(t, lock.skin), [VARIANTS_KT]: variantsKt(c) };
}

const args = process.argv.slice(2);
if (args[0] === "--sync") sync(args[1]);
const lock = JSON.parse(readFileSync(LOCK, "utf8"));
const out = render(lock);
if (args[0] === "--check") {
  const bad = FILES.filter((f) => sha(join(DIR, f)) !== lock.sha256[f]).map((f) => `design/hx-ui/${f} 与锁文件哈希不一致`);
  for (const [p, text] of Object.entries(out)) if (readFileSync(p, "utf8") !== text) bad.push(`${p.slice(ROOT.length + 1)} 不是最新, 运行 node tools/hx-ui-gen.mjs`);
  if (bad.length) {
    console.error(bad.join("\n"));
    process.exit(1);
  }
  console.log(`HX-UI ${lock.version} (${lock.skin}) 一致`);
} else {
  writeFileSync(LOCK, JSON.stringify({ ...lock, sha256: Object.fromEntries(FILES.map((f) => [f, sha(join(DIR, f))])) }, null, 2) + "\n");
  for (const [p, text] of Object.entries(out)) writeFileSync(p, text);
  console.log(`已生成 HxUiTokens.kt, HxVariants.kt (HX-UI ${lock.version}, 皮肤 ${lock.skin})`);
}
