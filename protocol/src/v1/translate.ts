import { API_V1 } from "./constants";

// 翻译 (#100): 客户端把正文切成段 (块级元素), 服务端去重, 查缓存, 再调用微软翻译, 按月计数, 用到上限自动停止

export const PATH_TRANSLATE = `${API_V1}/translate`;
export const PATH_TRANSLATE_USAGE = `${API_V1}/translate/usage`;
export const TRANSLATE_TO_DEFAULT = "zh-Hans";
export const TRANSLATE_FORMATS = ["text", "html"] as const;
export type TranslateFormat = (typeof TRANSLATE_FORMATS)[number];
/** 一次最多段数, 单段最长, 一次总字符 (微软单次上限 1000 段 / 5 万字符, 这里收紧)。 */
export const TRANSLATE_MAX_SEGS = 100;
export const TRANSLATE_MAX_SEG = 5000;
export const TRANSLATE_MAX_CHARS = 30_000;
const MAX_LANG = 16;

/** format=html 时段内可带行内标签 (b, a, span 等), 译文原样保留标签。 */
export type TranslateInput = { texts: string[]; to?: string; format?: TranslateFormat };
/** used / limit 为本月 (UTC) 已计费字符与自动停止线。 */
export type TranslateUsage = { month: string; used: number; limit: number; ready: boolean };
/** texts 与输入一一对应; 不需要翻译的段原样返回, from 为空串。 */
export type TranslateResult = { texts: string[]; from: string[]; cached: number; billed: number; usage: TranslateUsage };

const TAG = /<[^>]*>/g;
const ENTITY = /&[a-z#0-9]+;/gi;
const LETTER = /\p{L}/gu;
const HAN = /\p{Script=Han}/gu;
const KANA_HANGUL = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const URLISH = /^\s*(https?:\/\/\S+|[\w.+-]+@[\w-]+(\.[\w-]+)+|www\.\S+)\s*$/i;
// 中文字占字母一半以上就当中文, 不送去翻
const HAN_RATIO = 0.5;

/** 不值得翻译的段: 没有字母 (数字, 符号, 验证码), 只是链接或邮箱, 已经是中文。 */
export function skipSegment(text: string): boolean {
  const plain = text.replace(TAG, " ").replace(ENTITY, " ").trim();
  if (!plain || URLISH.test(plain)) return true;
  const letters = plain.match(LETTER)?.length ?? 0;
  if (letters === 0) return true;
  const han = plain.match(HAN)?.length ?? 0;
  return han / letters >= HAN_RATIO && !KANA_HANGUL.test(plain);
}

export function parseTranslateInput(v: unknown): TranslateInput | string {
  if (typeof v !== "object" || v === null) return "需要 JSON 对象";
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.texts) || o.texts.length === 0) return "需要 texts (字符串数组)";
  if (o.texts.length > TRANSLATE_MAX_SEGS) return `一次最多 ${TRANSLATE_MAX_SEGS} 段`;
  if (!o.texts.every((t) => typeof t === "string")) return "texts 只能是字符串";
  const texts = o.texts as string[];
  if (texts.some((t) => t.length > TRANSLATE_MAX_SEG)) return `单段最长 ${TRANSLATE_MAX_SEG} 字符`;
  if (texts.reduce((n, t) => n + t.length, 0) > TRANSLATE_MAX_CHARS) return `一次最多 ${TRANSLATE_MAX_CHARS} 字符`;
  const out: TranslateInput = { texts };
  if (o.to !== undefined) {
    if (typeof o.to !== "string" || !/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(o.to) || o.to.length > MAX_LANG) return "to 不是有效的语言代码";
    out.to = o.to;
  }
  if (o.format !== undefined) {
    if (!TRANSLATE_FORMATS.includes(o.format as TranslateFormat)) return "format 只能是 text 或 html";
    out.format = o.format as TranslateFormat;
  }
  return out;
}
