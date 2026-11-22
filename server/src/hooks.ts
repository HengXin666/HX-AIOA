import { isHookAdapter, type HookAdapter, type IngestResult, type KeyInfo, type SourceRef } from "@hx-aioa/protocol";
import { parseHookBody, runAdapter, typeInfo } from "./adapters";
import { GITHUB_SIGNATURE_HEADER } from "./adapters/github";
import { writeEvent } from "./api-events";
import { credentialOf, hmac, safeEqual } from "./auth";
import {
  CODE_FORBIDDEN,
  CODE_NOT_FOUND,
  CODE_RATE_LIMITED,
  CODE_UNAUTHORIZED,
  ERR_BAD_SIGNATURE,
  ERR_FORBIDDEN,
  ERR_NOT_FOUND,
  ERR_RATE,
  ERR_UNAUTHORIZED,
  HEADER_CONTENT_TYPE,
} from "./constants";
import type { Core, Principal } from "./core";
import { fail, json } from "./http";
import { Registry } from "./registry";

const SIG_PREFIX = "sha256=";
const MAX_HOOK_BYTES = 256_000;

// 有签名头时按 GitHub 方式验签, 否则要求 ?key= 或 Bearer 与路径里的 keyId 是同一把 key
async function authenticate(core: Core, req: Request, url: URL, key: KeyInfo, raw: string): Promise<boolean> {
  const sig = req.headers.get(GITHUB_SIGNATURE_HEADER);
  if (sig && core.env.TOKEN_SECRET) {
    const secret = await Registry.webhookSecret(core.env.TOKEN_SECRET, key.id);
    return safeEqual(sig, SIG_PREFIX + (await hmac(secret, raw)));
  }
  const found = await core.registry.keyBySecret(credentialOf(req, url));
  return found?.id === key.id;
}

// POST /api/v1/hooks/{adapter}/{keyId}: 外部系统原样推送, 适配器转成统一事件
export async function handleHook(core: Core, req: Request, url: URL, adapter: string, keyId: string): Promise<Response> {
  if (!isHookAdapter(adapter)) return fail(404, ERR_NOT_FOUND, CODE_NOT_FOUND);
  const key = core.registry.key(keyId);
  if (!key) return fail(401, ERR_UNAUTHORIZED, CODE_UNAUTHORIZED);
  const raw = await req.text();
  if (raw.length > MAX_HOOK_BYTES) return fail(413, "请求体过大");
  if (!(await authenticate(core, req, url, key, raw))) return fail(401, req.headers.has(GITHUB_SIGNATURE_HEADER) ? ERR_BAD_SIGNATURE : ERR_UNAUTHORIZED, CODE_UNAUTHORIZED);
  if (!key.scopes.includes("events:write")) return fail(403, ERR_FORBIDDEN, CODE_FORBIDDEN);
  if (!core.registry.allow(key)) return fail(429, ERR_RATE, CODE_RATE_LIMITED);
  const body = parseHookBody(raw, req.headers.get(HEADER_CONTENT_TYPE) ?? "", url.searchParams);
  const info = key.sourceId ? core.registry.source(key.sourceId) : null;
  const t = typeInfo(adapter as HookAdapter);
  const source: SourceRef = info ? { id: info.id, name: info.name, type: info.type } : { id: adapter, name: t?.name ?? adapter, type: t?.type ?? adapter };
  const icon = info?.icon ?? t?.icon;
  if (icon) source.icon = icon;
  const input = { body, headers: req.headers, source: { name: source.name, ...(info?.subject ? { subject: info.subject } : {}), ...(info?.mapping ? { mapping: info.mapping } : {}) } };
  const events = runAdapter(adapter as HookAdapter, input);
  if (typeof events === "string") return fail(400, events);
  const who: Principal = { owner: false, key };
  const results: IngestResult[] = [];
  for (const ev of events) results.push(await writeEvent(core, who, ev, { source, sourceInfo: info }));
  return json({ results });
}
