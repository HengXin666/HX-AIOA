import type { TranslateFormat } from "@hx-aioa/protocol";
import { ApiFail } from "../http";
import type { Env } from "../env";

// 微软 Azure Translator v3, F0 免费层每月 200 万字符; 全局资源不需要 region, 区域资源要带
const ENDPOINT = "https://api.cognitive.microsofttranslator.com/translate";
const API_VERSION = "3.0";
const CODE_UPSTREAM = "TRANSLATE_UPSTREAM";
const CODE_QUOTA = "TRANSLATE_QUOTA";

export type Translated = { text: string; from: string };
type AzureItem = { detectedLanguage?: { language?: string }; translations?: { text?: string }[] };

export const translateReady = (env: Env): boolean => Boolean(env.AZURE_TRANSLATOR_KEY);

export async function azureTranslate(env: Env, texts: string[], to: string, format: TranslateFormat, fetcher: typeof fetch = fetch): Promise<Translated[]> {
  const url = `${ENDPOINT}?api-version=${API_VERSION}&to=${encodeURIComponent(to)}&textType=${format === "html" ? "html" : "plain"}`;
  const headers: Record<string, string> = { "Content-Type": "application/json", "Ocp-Apim-Subscription-Key": env.AZURE_TRANSLATOR_KEY ?? "" };
  if (env.AZURE_TRANSLATOR_REGION) headers["Ocp-Apim-Subscription-Region"] = env.AZURE_TRANSLATOR_REGION;
  const res = await fetcher(url, { method: "POST", headers, body: JSON.stringify(texts.map((Text) => ({ Text }))) });
  if (res.status === 401 || res.status === 403) throw new ApiFail(502, CODE_UPSTREAM, "翻译密钥无效或区域不对 (AZURE_TRANSLATOR_KEY / AZURE_TRANSLATOR_REGION)");
  if (res.status === 429) throw new ApiFail(429, CODE_QUOTA, "微软翻译限流或免费额度已用完, 稍后再试");
  if (!res.ok) throw new ApiFail(502, CODE_UPSTREAM, `微软翻译出错 (${res.status})`);
  const items = (await res.json()) as AzureItem[];
  if (!Array.isArray(items) || items.length !== texts.length) throw new ApiFail(502, CODE_UPSTREAM, "微软翻译返回条数不对");
  return items.map((it) => ({ text: it.translations?.[0]?.text ?? "", from: it.detectedLanguage?.language ?? "" }));
}
