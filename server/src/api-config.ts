import {
  HOOK_ADAPTERS,
  PATH_HOOKS,
  PATH_KEYS,
  PATH_RULES,
  PATH_RULES_ORDER,
  PATH_RULES_TEST,
  PATH_SETTINGS,
  PATH_SOURCES,
  PATH_SOURCE_TYPES,
  SCOPES,
  parseEventInput,
  parseSourceInput,
  type Envelope,
  type KeyCreated,
  type KeyInfo,
  type KeyRequest,
  type Scope,
  type SourceCreated,
} from "@hx-aioa/protocol";
import { SOURCE_TYPE_INFOS } from "./adapters";
import { originOf } from "./api-events";
import { CODE_NOT_FOUND, DELETE, ERR_NO_RESOURCE, GET, PATCH, POST, PUT } from "./constants";
import { type Core, OWNER, type ReqCtx, type Route, route } from "./core";
import { BUILTIN_RULES } from "./rules/builtin";
import { decide } from "./rules/engine";
import { groupContext } from "./group";
import { badJson, fail, json, readJson } from "./http";
import { Registry } from "./registry";

const RECENT_FOR_TEST = 300;
const notFound = () => fail(404, ERR_NO_RESOURCE, CODE_NOT_FOUND);
const idParam = (c: ReqCtx) => decodeURIComponent(c.params[0] ?? "");

async function keyCreated(core: Core, origin: string, info: KeyInfo, key: string): Promise<KeyCreated> {
  const secret = core.env.TOKEN_SECRET ? await Registry.webhookSecret(core.env.TOKEN_SECRET, info.id) : "";
  const webhookUrls = Object.fromEntries(HOOK_ADAPTERS.map((a) => [a, `${origin}${PATH_HOOKS}/${a}/${info.id}`]));
  return { ...info, key, webhookSecret: secret, webhookUrls };
}

function parseKeyRequest(raw: unknown): KeyRequest | string {
  if (typeof raw !== "object" || raw === null) return "key 请求必须是对象";
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== "string" || !r.name) return "需要 name";
  if (!Array.isArray(r.scopes) || !r.scopes.length || !r.scopes.every((s) => (SCOPES as readonly string[]).includes(String(s)))) return "scopes 取值错误";
  const out: KeyRequest = { name: r.name, scopes: r.scopes as Scope[] };
  if (Array.isArray(r.channels)) out.channels = r.channels.filter((x): x is string => typeof x === "string");
  if (typeof r.ratePerMin === "number" && r.ratePerMin > 0) out.ratePerMin = Math.floor(r.ratePerMin);
  if (typeof r.sourceId === "string" && r.sourceId) out.sourceId = r.sourceId;
  if (typeof r.subject === "string" && r.subject) out.subject = r.subject;
  return out;
}

async function createKey(c: ReqCtx): Promise<Response> {
  const req = parseKeyRequest(await readJson(c.req));
  if (typeof req === "string") return fail(400, req);
  if (req.sourceId && !c.core.registry.source(req.sourceId)) return fail(400, "sourceId 不存在");
  const { info, key } = await c.core.registry.createKey(req);
  return json(await keyCreated(c.core, c.url.origin, info, key));
}

async function createSource(c: ReqCtx): Promise<Response> {
  const input = parseSourceInput(await readJson(c.req));
  if (typeof input === "string") return fail(400, input);
  const info = c.core.registry.createSource(input);
  const out: SourceCreated = { ...info };
  if (input.key) {
    const req: KeyRequest = { name: info.name, scopes: input.key.scopes ?? ["events:write"], sourceId: info.id };
    if (input.key.ratePerMin) req.ratePerMin = input.key.ratePerMin;
    if (info.subject) req.subject = info.subject;
    const { info: k, key } = await c.core.registry.createKey(req);
    info.keyId = k.id;
    c.core.registry.saveSource(info);
    out.keyId = k.id;
    out.key = await keyCreated(c.core, c.url.origin, k, key);
  }
  return json(out);
}

async function patchSource(c: ReqCtx): Promise<Response> {
  const cur = c.core.registry.source(idParam(c));
  if (!cur) return notFound();
  const input = parseSourceInput(await readJson(c.req), true);
  if (typeof input === "string") return fail(400, input);
  const { key: _k, ...rest } = input;
  const next = { ...cur, ...Object.fromEntries(Object.entries(rest).filter(([k, v]) => v !== undefined && !(k === "name" && v === ""))) };
  if (input.rules) next.rules = input.rules.map((r, i) => ({ ...r, id: `${cur.id}:${i}` }));
  c.core.registry.saveSource(next);
  return json(next);
}

// 试运行: 不入库, 返回这条事件此刻会被如何处理
async function testRule(c: ReqCtx): Promise<Response> {
  const p = parseEventInput(await readJson(c.req));
  if (!p.ok) return fail(400, p.error);
  const origin = originOf(c.core, c.who);
  const ev = { id: "test", seq: 0, ts: Date.now(), kind: p.value.kind, source: origin.source, priority: p.value.priority ?? "happening", data: p.value.data } as Envelope;
  if (p.value.subject) ev.subject = p.value.subject;
  if (p.value.channel) ev.channel = p.value.channel;
  if (p.value.groupKey) ev.groupKey = p.value.groupKey;
  const settings = await c.core.config.settings();
  const sets = await c.core.pipeline.ruleSets(ev, origin.sourceInfo);
  const gc = groupContext(ev, c.core.store.recent(RECENT_FOR_TEST), ev.ts);
  const ctx = { now: ev.ts, tz: await c.core.config.tz(), ...gc, ...(settings.quiet ? { quiet: settings.quiet } : {}) };
  return json({ route: decide(ev, sets, ctx) });
}

function ruleResult(r: unknown): Response {
  if (r === null) return notFound();
  if (typeof r === "string") return fail(400, r);
  return json(r);
}

export const CONFIG_ROUTES: Route[] = [
  route(GET, PATH_RULES, OWNER, async (c) => json({ rules: [...(await c.core.config.rules()), ...BUILTIN_RULES] })),
  route(POST, PATH_RULES, OWNER, async (c) => ruleResult(await c.core.config.addRule(await readJson(c.req)))),
  route(PUT, PATH_RULES_ORDER, OWNER, async (c) => {
    const body = (await readJson(c.req)) as { ids?: unknown } | undefined;
    if (!Array.isArray(body?.ids)) return badJson();
    const r = await c.core.config.reorder(body.ids.map(String));
    return typeof r === "string" ? fail(400, r) : json({ rules: [...r, ...BUILTIN_RULES] });
  }),
  route(POST, PATH_RULES_TEST, OWNER, testRule),
  route(PUT, `${PATH_RULES}/{id}`, OWNER, async (c) => ruleResult(await c.core.config.replaceRule(idParam(c), await readJson(c.req)))),
  route(DELETE, `${PATH_RULES}/{id}`, OWNER, async (c) => ((await c.core.config.deleteRule(idParam(c))) ? json({ ok: true }) : notFound())),
  route(GET, PATH_SETTINGS, OWNER, async (c) => json({ settings: await c.core.config.settings() })),
  route(PATCH, PATH_SETTINGS, OWNER, async (c) => {
    const r = await c.core.config.patchSettings(await readJson(c.req));
    if (typeof r === "string") return fail(400, r);
    c.core.sockets.toV1Clients({ t: "settings", settings: r });
    return json({ settings: r });
  }),
  route(GET, PATH_KEYS, OWNER, (c) => json({ keys: c.core.registry.keys() })),
  route(POST, PATH_KEYS, OWNER, createKey),
  route(DELETE, `${PATH_KEYS}/{id}`, OWNER, (c) => (c.core.registry.deleteKey(idParam(c)) ? json({ ok: true }) : notFound())),
  route(GET, PATH_SOURCE_TYPES, OWNER, () => json({ types: SOURCE_TYPE_INFOS })),
  route(GET, PATH_SOURCES, OWNER, (c) => json({ sources: c.core.registry.sources() })),
  route(POST, PATH_SOURCES, OWNER, createSource),
  route(GET, `${PATH_SOURCES}/{id}`, OWNER, (c) => {
    const s = c.core.registry.source(idParam(c));
    return s ? json(s) : notFound();
  }),
  route(PATCH, `${PATH_SOURCES}/{id}`, OWNER, patchSource),
  route(DELETE, `${PATH_SOURCES}/{id}`, OWNER, (c) => (c.core.registry.deleteSource(idParam(c)) ? json({ ok: true }) : notFound())),
];
