import {
  PATH_TRANSLATE,
  PATH_TRANSLATE_USAGE,
  TRANSLATE_TO_DEFAULT,
  parseTranslateInput,
  skipSegment,
  type TranslateResult,
  type TranslateProvider,
  type TranslateUsage,
} from "@hx-aioa/protocol";
import { GET, POST } from "../constants";
import { type Core, OWNER, type ReqCtx, type Route, route } from "../core";
import { badJson, fail, json, readJson } from "../http";
import { azureTranslate, translateReady } from "./azure";
import { googleTranslate } from "./google";
import { cacheKey, monthOf } from "./store";

// 配了微软密钥走微软 F0 (每月 200 万字符, 用到九成自动停, 可用 TRANSLATE_MONTH_LIMIT 调整);
// 没配走谷歌免费通道 (不限额, 只记数); TRANSLATE_PROVIDER 可强制指定
const DEFAULT_LIMIT = 1_800_000;
const CODE_OFF = "TRANSLATE_OFF";
const CODE_QUOTA = "TRANSLATE_QUOTA";

function providerOf(core: Core): TranslateProvider {
  const p = core.env.TRANSLATE_PROVIDER;
  if (p === "azure" || p === "google") return p;
  return translateReady(core.env) ? "azure" : "google";
}

export function usageOf(core: Core, now = Date.now()): TranslateUsage {
  const n = Number(core.env.TRANSLATE_MONTH_LIMIT);
  const limit = Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_LIMIT;
  const month = monthOf(now);
  const provider = providerOf(core);
  return { month, used: core.tr.used(month), limit, ready: provider === "google" || translateReady(core.env), provider };
}

async function translate(c: ReqCtx): Promise<Response> {
  const body = await readJson(c.req);
  if (body === undefined) return badJson();
  const p = parseTranslateInput(body);
  if (typeof p === "string") return fail(400, p);
  const to = p.to ?? TRANSLATE_TO_DEFAULT;
  const format = p.format ?? "text";
  const now = Date.now();
  const texts = [...p.texts];
  const from = texts.map(() => "");
  // 同一段原文只译一次
  const todo = new Map<string, { text: string; idx: number[] }>();
  let cached = 0;
  for (const [i, t] of p.texts.entries()) {
    if (skipSegment(t)) continue;
    const h = await cacheKey(to, format, t);
    const hit = c.core.tr.get(h);
    if (hit) {
      texts[i] = hit.out;
      from[i] = hit.src;
      cached++;
      continue;
    }
    const e = todo.get(h);
    if (e) e.idx.push(i);
    else todo.set(h, { text: t, idx: [i] });
  }
  const usage = usageOf(c.core, now);
  const misses = [...todo.entries()];
  const billed = misses.reduce((n, [, e]) => n + e.text.length, 0);
  if (billed > 0) {
    if (!usage.ready) return fail(503, "服务端还没配置翻译密钥 (AZURE_TRANSLATOR_KEY)", CODE_OFF);
    const azure = usage.provider === "azure";
    if (azure && usage.used + billed > usage.limit) return fail(429, `本月免费额度快用完了, 已自动停止 (${usage.used}/${usage.limit} 字符)`, CODE_QUOTA);
    const src = misses.map(([, e]) => e.text);
    const out = azure ? await azureTranslate(c.core.env, src, to, format) : await googleTranslate(src, to, format);
    c.core.tr.bill(usage.month, billed);
    usage.used += billed;
    for (const [k, [h, e]] of misses.entries()) {
      const r = out[k]!;
      c.core.tr.put(h, r.text, r.from, now);
      for (const i of e.idx) {
        texts[i] = r.text;
        from[i] = r.from;
      }
    }
  }
  return json({ texts, from, cached, billed, usage } satisfies TranslateResult);
}

export const TRANSLATE_ROUTES: Route[] = [route(POST, PATH_TRANSLATE, OWNER, translate), route(GET, PATH_TRANSLATE_USAGE, OWNER, (c) => json(usageOf(c.core)))];
