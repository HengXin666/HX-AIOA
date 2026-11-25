import type { TranslateFormat } from "@hx-aioa/protocol";
import { ApiFail } from "../http";
import type { Translated } from "./azure";

// 谷歌网页翻译组件 (te_lib) 背后的接口, 沉浸式翻译等扩展的免费谷歌通道也是它。
// 非公开接口: 不用注册, 没有额度, 但可能限流或失效; key 是组件里内置的公开 key, 不是谁的密钥
const ENDPOINT = "https://translate-pa.googleapis.com/v1/translateHtml";
const PUBLIC_KEY = "AIzaSyATBXajvzQLTDHEQbcpq0Ihe0vWDHmO520";
const LANG: Record<string, string> = { "zh-Hans": "zh-CN", "zh-Hant": "zh-TW" };
// 一次请求的段数上限 (沉浸式翻译也是 50)
const BATCH = 50;
const CODE_UPSTREAM = "TRANSLATE_UPSTREAM";

const escape = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", "#x27": "'", nbsp: " " };
const unescape = (t: string) => t.replace(/&(amp|lt|gt|quot|apos|#39|#x27|nbsp);/g, (_, k: string) => ENTITIES[k]!);

async function batch(texts: string[], to: string, format: TranslateFormat, fetcher: typeof fetch): Promise<Translated[]> {
  const input = format === "html" ? texts : texts.map(escape);
  const res = await fetcher(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json+protobuf", "X-Goog-API-Key": PUBLIC_KEY },
    body: JSON.stringify([[input, "auto", LANG[to] ?? to], "te"]),
  });
  if (res.status === 429 || res.status === 403) throw new ApiFail(429, "TRANSLATE_QUOTA", "谷歌免费翻译暂时限流, 稍后再试");
  if (!res.ok) throw new ApiFail(502, CODE_UPSTREAM, `谷歌翻译出错 (${res.status})`);
  const body = (await res.json()) as [string[], string[]?];
  const outs = Array.isArray(body) ? body[0] : undefined;
  if (!Array.isArray(outs) || outs.length !== texts.length) throw new ApiFail(502, CODE_UPSTREAM, "谷歌翻译返回条数不对");
  const langs = Array.isArray(body[1]) ? body[1] : [];
  return outs.map((t, i) => ({ text: format === "html" ? t : unescape(t), from: langs[i] ?? "" }));
}

export async function googleTranslate(texts: string[], to: string, format: TranslateFormat, fetcher: typeof fetch = fetch): Promise<Translated[]> {
  const out: Translated[] = [];
  for (let i = 0; i < texts.length; i += BATCH) out.push(...(await batch(texts.slice(i, i + BATCH), to, format, fetcher)));
  return out;
}
