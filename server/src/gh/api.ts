import {
  PATH_GH,
  PATH_GH_AGENT,
  PATH_GH_COMMENTS,
  PATH_GH_DEVICE,
  PATH_GH_DEVICE_POLL,
  PATH_GH_ISSUE,
  PATH_GH_ISSUES,
  PATH_GH_REPOS,
  PATH_GH_RULES,
  PATH_GH_SUB,
  PATH_GH_TOKEN,
  TODO_SYNC_TOPIC,
  parseGhIssueInput,
  parseGhIssuePatch,
  parseGhRules,
  type ChatSyncFrame,
  type GhIssue,
  type GhStatus,
} from "@hx-aioa/protocol";
import { CODE_FORBIDDEN, DELETE, ERR_FORBIDDEN, GET, PATCH, POST, PUT } from "../constants";
import { type Core, OWNER, type ReqCtx, ROOM, type Route, route } from "../core";
import { ApiFail, fail, json, readJson } from "../http";
import { canWriteTodos } from "../plugins/api";
import { gh } from "./client";
import { syncTodoIssues } from "./todo-sync";

const p = (c: ReqCtx, i: number) => decodeURIComponent(c.params[i] ?? "");
const repoOf = (c: ReqCtx) => `${p(c, 0)}/${p(c, 1)}`;
const numOf = (c: ReqCtx) => {
  const n = Number(p(c, 2));
  if (!Number.isInteger(n) || n <= 0) throw new ApiFail(400, "bad_request", "issue 号不对");
  return n;
};
const ISSUE_LIMIT = 50;

type RawIssue = { id: number; number: number; title: string; state: string; html_url: string; comments: number; updated_at: string; pull_request?: unknown };
const issueOf = (repo: string, r: RawIssue): GhIssue => ({
  repo,
  number: r.number,
  title: r.title,
  state: r.state === "closed" ? "closed" : "open",
  url: r.html_url,
  comments: r.comments,
  updated: Date.parse(r.updated_at),
});

function status(c: ReqCtx): Response {
  const g = c.core.gh;
  const auth = g.auth();
  const body: GhStatus = { rules: g.store.rules(), device: g.deviceOk, agents: g.agents(c.core), ops: g.store.ops(), ...(auth ? { auth } : {}) };
  return json(body);
}

async function putToken(c: ReqCtx): Promise<Response> {
  const b = (await readJson(c.req)) as { token?: unknown } | undefined;
  if (typeof b?.token !== "string" || b.token.length < 20) return fail(400, "需要 { \"token\": \"github_pat_...\" }");
  return json({ auth: await c.core.gh.setPat(b.token.trim()) });
}

function delToken(c: ReqCtx): Response {
  c.core.gh.revoke();
  return json({ ok: true });
}

async function device(c: ReqCtx): Promise<Response> {
  return json(await c.core.gh.startDevice());
}

async function poll(c: ReqCtx): Promise<Response> {
  return json(await c.core.gh.pollDevice(p(c, 0)));
}

async function repos(c: ReqCtx): Promise<Response> {
  return json({ repos: await c.core.gh.repos(c.url.searchParams.get("fresh") === "1"), rules: c.core.gh.store.rules() });
}

async function rules(c: ReqCtx): Promise<Response> {
  const r = parseGhRules(await readJson(c.req));
  if (typeof r === "string") return fail(400, r);
  c.core.gh.store.setRules(r);
  return json({ rules: r });
}

async function grant(c: ReqCtx): Promise<Response> {
  const b = (await readJson(c.req)) as { allowed?: unknown } | undefined;
  if (typeof b?.allowed !== "boolean") return fail(400, "需要 { \"allowed\": true | false }");
  c.core.gh.store.setGrant(p(c, 0), b.allowed);
  return json({ agents: c.core.gh.agents(c.core) });
}

// Agent 和主人共用的 issue 代理: 先查权限和仓库范围, 再用服务端令牌调 GitHub, 每次都记一笔
async function guard(c: ReqCtx): Promise<{ token: string; repo: string }> {
  if (!c.core.gh.canUse(c.core, c.who)) throw new ApiFail(403, CODE_FORBIDDEN, "这个 Agent 没有 GitHub 权限, 请主人在 GitHub 授权插件里打开");
  const repo = repoOf(c);
  await c.core.gh.ensureRepo(repo);
  return { token: await c.core.gh.token(), repo };
}

async function run<T>(c: ReqCtx, repo: string, op: string, issue: number | undefined, fn: () => Promise<T>): Promise<T> {
  try {
    const out = await fn();
    c.core.gh.log(c.core, c.who, { op, repo, ok: true, ...(issue ? { issue } : {}) });
    return out;
  } catch (e) {
    c.core.gh.log(c.core, c.who, { op, repo, ok: false, note: e instanceof Error ? e.message.slice(0, 120) : String(e), ...(issue ? { issue } : {}) });
    throw e;
  }
}

async function listIssues(c: ReqCtx): Promise<Response> {
  const { token, repo } = await guard(c);
  const state = c.url.searchParams.get("state") === "closed" ? "closed" : c.url.searchParams.get("state") === "all" ? "all" : "open";
  const body = (await gh(token, `/repos/${repo}/issues?state=${state}&per_page=${ISSUE_LIMIT}`)).body as RawIssue[];
  return json({ issues: body.filter((r) => !r.pull_request).map((r) => issueOf(repo, r)) });
}

async function getIssue(c: ReqCtx): Promise<Response> {
  const { token, repo } = await guard(c);
  const r = (await gh(token, `/repos/${repo}/issues/${numOf(c)}`)).body as RawIssue & { body?: string };
  return json({ issue: issueOf(repo, r), body: r.body ?? "" });
}

async function linkTodo(core: Core, c: ReqCtx, todo: { channel: string; id: string }, repo: string, n: number): Promise<void> {
  if (!canWriteTodos(core, c.who, todo.channel)) return;
  const out = core.todos.upsert(todo.channel, [{ id: todo.id, repo, issue: n }]);
  if (typeof out !== "string" && out.length) core.sockets.toAllClients({ t: "chat_sync", topic: TODO_SYNC_TOPIC, channel: todo.channel } satisfies ChatSyncFrame);
}

async function createIssue(c: ReqCtx): Promise<Response> {
  const input = parseGhIssueInput(await readJson(c.req));
  if (typeof input === "string") return fail(400, input);
  const { token, repo } = await guard(c);
  const r = await run(c, repo, "建 issue", undefined, async () => {
    const created = (await gh(token, `/repos/${repo}/issues`, { method: POST, body: { title: input.title, body: input.body ?? "", ...(input.labels ? { labels: input.labels } : {}) } })).body as RawIssue;
    if (input.parent) await gh(token, `/repos/${repo}/issues/${input.parent}/sub_issues`, { method: POST, body: { sub_issue_id: created.id } });
    return created;
  });
  if (input.todo) await linkTodo(c.core, c, input.todo, repo, r.number);
  return json({ issue: issueOf(repo, r) });
}

async function patchIssue(c: ReqCtx): Promise<Response> {
  const patch = parseGhIssuePatch(await readJson(c.req));
  if (typeof patch === "string") return fail(400, patch);
  const { token, repo } = await guard(c);
  const n = numOf(c);
  const op = patch.state === "closed" ? "关 issue" : patch.state === "open" ? "重开 issue" : "改 issue";
  const r = await run(c, repo, op, n, async () => (await gh(token, `/repos/${repo}/issues/${n}`, { method: PATCH, body: patch })).body as RawIssue);
  if (patch.state) await syncTodoIssues(c.core, new Set([`${repo.toLowerCase()}#${n}`])).catch(() => 0);
  return json({ issue: issueOf(repo, r) });
}

async function comment(c: ReqCtx): Promise<Response> {
  const b = (await readJson(c.req)) as { body?: unknown } | undefined;
  if (typeof b?.body !== "string" || !b.body.trim()) return fail(400, "需要 { \"body\": \"评论\" }");
  const { token, repo } = await guard(c);
  const n = numOf(c);
  await run(c, repo, "评论 issue", n, () => gh(token, `/repos/${repo}/issues/${n}/comments`, { method: POST, body: { body: b.body } }));
  await syncTodoIssues(c.core, new Set([`${repo.toLowerCase()}#${n}`])).catch(() => 0);
  return json({ ok: true });
}

async function addSub(c: ReqCtx): Promise<Response> {
  const b = (await readJson(c.req)) as { issue?: unknown } | undefined;
  if (!(typeof b?.issue === "number" && Number.isInteger(b.issue) && b.issue > 0)) return fail(400, "需要 { \"issue\": 子 issue 号 }");
  const { token, repo } = await guard(c);
  const n = numOf(c);
  await run(c, repo, `挂子 issue #${b.issue}`, n, async () => {
    const child = (await gh(token, `/repos/${repo}/issues/${b.issue}`)).body as RawIssue;
    return gh(token, `/repos/${repo}/issues/${n}/sub_issues`, { method: POST, body: { sub_issue_id: child.id } });
  });
  return json({ ok: true });
}

// 子号不能碰; 其余由 guard 判
function room(handler: (c: ReqCtx) => Promise<Response>) {
  return (c: ReqCtx) => (c.who.owner || (!c.who.member && !c.who.key.ext) ? handler(c) : fail(403, ERR_FORBIDDEN, CODE_FORBIDDEN));
}

export const GH_ROUTES: Route[] = [
  route(GET, PATH_GH, OWNER, status),
  route(PUT, PATH_GH_TOKEN, OWNER, putToken),
  route(DELETE, PATH_GH_TOKEN, OWNER, delToken),
  route(POST, PATH_GH_DEVICE, OWNER, device),
  route(POST, PATH_GH_DEVICE_POLL, OWNER, poll),
  route(GET, PATH_GH_REPOS, OWNER, repos),
  route(PUT, PATH_GH_RULES, OWNER, rules),
  route(PUT, PATH_GH_AGENT, OWNER, grant),
  route(GET, PATH_GH_ISSUES, ROOM, room(listIssues)),
  route(POST, PATH_GH_ISSUES, ROOM, room(createIssue)),
  route(GET, PATH_GH_ISSUE, ROOM, room(getIssue)),
  route(PATCH, PATH_GH_ISSUE, ROOM, room(patchIssue)),
  route(POST, PATH_GH_COMMENTS, ROOM, room(comment)),
  route(POST, PATH_GH_SUB, ROOM, room(addSub)),
];
