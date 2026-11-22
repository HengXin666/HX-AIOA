import { POST } from "./constants";
import { OWNER, type Route, route } from "./core";
import { badJson, fail, json, readJson } from "./http";

export const PATH_SUB_RELAY = "/api/v1/relay/subscription";
const RELAY_UA = "clash-verge/v2.2.3";
const RELAY_TIMEOUT_MS = 15_000;
const MAX_BYTES = 4 * 1024 * 1024;
const SNIPPET = 80;

// 有的机场屏蔽国内 IP 拉订阅, 手机直连会 403; 由 Worker 在境外代拉, 原样把正文和状态码交回 App
async function relay(raw: unknown): Promise<Response> {
  const url = typeof raw === "object" && raw ? (raw as { url?: unknown }).url : undefined;
  if (typeof url !== "string" || !/^https?:\/\//.test(url)) return badJson();
  const resp = await fetch(url, {
    headers: { "User-Agent": RELAY_UA, Accept: "*/*" },
    signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
  }).catch((e: unknown) => e as Error);
  if (resp instanceof Error) return fail(502, `代拉失败: ${resp.message}`);
  const text = await resp.text();
  if (text.length > MAX_BYTES) return fail(502, "订阅过大");
  if (!resp.ok) return fail(502, `机场返回 HTTP ${resp.status}: ${text.replace(/\s+/g, " ").slice(0, SNIPPET)}`);
  return json({ status: resp.status, body: text });
}

export const RELAY_ROUTES: Route[] = [route(POST, PATH_SUB_RELAY, OWNER, async (c) => relay(await readJson(c.req)))];
