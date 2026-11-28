import { PATH_TRANSLATE, type TranslateResult } from "@hx-aioa/protocol";
import { api } from "./auth";

// 邮件翻译 (移植安卓 MailTranslate.kt): 按块级标签切段, 跳过样式脚本与不用翻的段, 分批送去翻, 再填回原位
const MAX_BATCH = 100;
const MAX_CHARS = 28_000;
const MAX_SEG = 4_500;
const MIN_LETTERS = 8;
const TOKEN = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
const ANY_TAG = /<[^>]*>/g;
const ENTITY = /&[a-zA-Z#0-9]+;/g;
const LINK_ONLY = /^(https?:\/\/\S+|\S+@\S+\.\S+)$/;
const SKIP = new Set(["style", "script", "head", "title", "noscript", "svg", "code", "textarea"]);
const BLOCK = new Set(
  "html body p div td th tr table tbody thead tfoot li ul ol dl dt dd h1 h2 h3 h4 h5 h6 br hr blockquote section article header footer center pre main nav aside figure figcaption form img".split(" "),
);

type Seg = { start: number; end: number; raw: string };
type Script = { letters: number; han: number; kana: number; hangul: number; cyr: number; accented: number };

function scriptOf(t: string): Script {
  const s: Script = { letters: 0, han: 0, kana: 0, hangul: 0, cyr: 0, accented: 0 };
  for (const ch of t) {
    if (!/\p{L}/u.test(ch)) continue;
    s.letters++;
    if (/\p{Script=Han}/u.test(ch)) s.han++;
    else if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(ch)) s.kana++;
    else if (/\p{Script=Hangul}/u.test(ch)) s.hangul++;
    else if (/\p{Script=Cyrillic}/u.test(ch)) s.cyr++;
    else if (ch.charCodeAt(0) > 0x7f) s.accented++;
  }
  return s;
}

// 和服务端跳过规则一致: 没字母, 纯链接或邮箱, 中文都不翻
function needsTr(text: string): boolean {
  const t = text.trim();
  if (!t || LINK_ONLY.test(t)) return false;
  const s = scriptOf(t);
  if (s.letters === 0) return false;
  return s.kana + s.hangul > 0 || s.han * 2 < s.letters;
}

const plainOf = (raw: string) => raw.replace(ANY_TAG, "").replace(ENTITY, " ").trim();

// 邮件是哪种外文, 显示在翻译条上; 中文或字太少返回 null (不出翻译条)
export function trLangOf(html: string): string | null {
  const text = plainOf(html.replace(/<(style|script)[\s\S]*?<\/\1>/gi, " "));
  const s = scriptOf(text);
  if (s.letters < MIN_LETTERS || !needsTr(text)) return null;
  if (s.kana > 0) return "日文";
  if (s.hangul > 0) return "韩文";
  if (s.cyr * 2 > s.letters) return "俄文";
  if (s.accented * 50 > s.letters) return "外文";
  return "英文";
}

function segments(html: string): Seg[] {
  const out: Seg[] = [];
  let skip: string | null = null;
  let segStart = -1;
  let pos = 0;
  const close = (end: number) => {
    if (segStart >= 0 && end > segStart) {
      const raw = html.slice(segStart, end);
      if (raw.length <= MAX_SEG && needsTr(plainOf(raw))) out.push({ start: segStart, end, raw });
    }
    segStart = -1;
  };
  for (const t of html.matchAll(TOKEN)) {
    const at = t.index;
    const name = (t[2] ?? "").toLowerCase();
    const closing = t[1] === "/";
    if (skip) {
      if (closing && name === skip) {
        skip = null;
        pos = at + t[0].length;
      }
      continue;
    }
    if (at > pos && segStart < 0) segStart = pos;
    if (!name || BLOCK.has(name)) close(at);
    else if (!closing && SKIP.has(name)) {
      close(at);
      skip = name;
    } else if (segStart < 0) segStart = at;
    pos = at + t[0].length;
  }
  if (!skip) {
    if (pos < html.length && segStart < 0) segStart = pos;
    close(html.length);
  }
  return out;
}

function batches(segs: Seg[]): number[][] {
  const out: number[][] = [];
  let cur: number[] = [];
  let chars = 0;
  segs.forEach((s, i) => {
    if (cur.length && (cur.length >= MAX_BATCH || chars + s.raw.length > MAX_CHARS)) {
      out.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(i);
    chars += s.raw.length;
  });
  if (cur.length) out.push(cur);
  return out;
}

export async function translateHtml(html: string): Promise<string> {
  const segs = segments(html);
  const tr = new Map<number, string>();
  for (const b of batches(segs)) {
    const r = await api<TranslateResult>(PATH_TRANSLATE, { method: "POST", body: JSON.stringify({ texts: b.map((i) => segs[i]!.raw), format: "html" }) });
    b.forEach((i, j) => r.texts[j] !== undefined && tr.set(i, r.texts[j]!));
  }
  let out = "";
  let last = 0;
  segs.forEach((s, i) => {
    const t = tr.get(i);
    if (t === undefined) return;
    out += html.slice(last, s.start) + t;
    last = s.end;
  });
  return out + html.slice(last);
}
