import { type RouteInfo, type TodoGh, type TodoItem, type TodoState } from "@hx-aioa/protocol";
import { messageInput } from "../api-events";
import type { Core } from "../core";
import { syncTodos } from "../plugins/api-todos";
import { graphql } from "./client";
import { ghOn } from "./gate";

// GitHub issue -> 待办状态: 关闭 = 已完成; 有评论 = 进行中; 重新打开 = 回到待进行。挂起由人定, 同步不动它
const CHUNK = 40;
const SYNC_GAP = 5 * 60_000;
const NOTICE_SOURCE = { id: "system:gh", name: "系统", icon: "circle-check-big" };
const NOTICE_ROUTE: RouteInfo = { action: "silent", channels: ["ws"], reason: "GitHub 同步" };
const FIELDS = "state title comments { totalCount } parent { number } subIssuesSummary { total }";
const FIELDS_LITE = "state title comments { totalCount }";

type Hit = { grp: string; item: TodoItem };
type IssueData = { state?: string; title?: string; comments?: { totalCount?: number }; parent?: { number?: number } | null; subIssuesSummary?: { total?: number } };

let last = 0;

export function nextState(cur: TodoState, prev: TodoGh | undefined, gh: TodoGh): TodoState | undefined {
  if (gh.state === "closed") return cur === "done" || cur === "dropped" ? undefined : "done";
  if (cur === "done" && prev?.state === "closed") return gh.comments > 0 ? "doing" : "open";
  if (cur === "open" && gh.comments > 0) return "doing";
  return undefined;
}

function ghOf(d: IssueData, now: number): TodoGh {
  return {
    state: d.state === "CLOSED" ? "closed" : "open",
    comments: d.comments?.totalCount ?? 0,
    ...(d.parent?.number ? { parent: d.parent.number } : {}),
    ...(d.subIssuesSummary?.total ? { subs: d.subIssuesSummary.total } : {}),
    ...(d.title ? { title: d.title } : {}),
    synced: now,
  };
}

const lit = (v: string) => JSON.stringify(v);

function queryOf(hits: Hit[], fields: string): string {
  const byRepo = new Map<string, Set<number>>();
  for (const h of hits) (byRepo.get(h.item.repo!) ?? byRepo.set(h.item.repo!, new Set()).get(h.item.repo!)!).add(h.item.issue!);
  const parts = [...byRepo.entries()].map(([repo, nums], ri) => {
    const [owner, name] = repo.split("/");
    const issues = [...nums].map((n) => `i${n}: issue(number: ${n}) { ${fields} }`).join(" ");
    return `r${ri}: repository(owner: ${lit(owner!)}, name: ${lit(name!)}) { nameWithOwner ${issues} }`;
  });
  return `query { ${parts.join(" ")} }`;
}

async function fetchChunk(token: string, hits: Hit[]): Promise<Map<string, IssueData>> {
  let data: Record<string, unknown>;
  try {
    data = await graphql(token, queryOf(hits, FIELDS));
  } catch {
    // 子 issue 字段在部分实例上没有, 退回基础字段
    data = await graphql(token, queryOf(hits, FIELDS_LITE));
  }
  const out = new Map<string, IssueData>();
  for (const r of Object.values(data)) {
    if (!r || typeof r !== "object") continue;
    const repo = String((r as { nameWithOwner?: unknown }).nameWithOwner ?? "").toLowerCase();
    for (const [k, v] of Object.entries(r)) if (k.startsWith("i") && v && typeof v === "object") out.set(`${repo}#${k.slice(1)}`, v as IssueData);
  }
  return out;
}

async function notice(core: Core, channel: string, text: string): Promise<void> {
  const input = messageInput({ text });
  if (typeof input === "string") return;
  input.channel = channel;
  await core.pipeline.fromInput(input, { source: NOTICE_SOURCE }, NOTICE_ROUTE);
}

/** 同步关联的 issue; only 给定时只同步这些 (repo#number, 小写)。返回有变化的条目数。 */
export async function syncTodoIssues(core: Core, only?: Set<string>): Promise<number> {
  if (!ghOn(core) || !core.gh.auth()) return 0;
  const hits = core.todos.linked().filter((h) => !only || only.has(`${h.item.repo!.toLowerCase()}#${h.item.issue}`));
  if (!hits.length) return 0;
  const token = await core.gh.token();
  const now = Date.now();
  const touched = new Map<string, number>();
  let changed = 0;
  for (let i = 0; i < hits.length; i += CHUNK) {
    const chunk = hits.slice(i, i + CHUNK);
    const got = await fetchChunk(token, chunk);
    for (const h of chunk) {
      const d = got.get(`${h.item.repo!.toLowerCase()}#${h.item.issue}`);
      if (!d) continue;
      const gh = ghOf(d, now);
      const state = nextState(h.item.state, h.item.gh, gh);
      const same = h.item.gh && JSON.stringify({ ...h.item.gh, synced: 0 }) === JSON.stringify({ ...gh, synced: 0 });
      if (same && !state) continue;
      const r = core.todos.setGh(h.grp, h.item.id, gh, state, now);
      if (!r?.rev) continue;
      touched.set(h.grp, Math.max(touched.get(h.grp) ?? 0, r.rev));
      changed += 1;
      if (state === "done") await notice(core, h.grp, `${h.item.repo}#${h.item.issue} 已关闭, 待办 "${h.item.title}" 自动完成`);
    }
  }
  for (const [channel, rev] of touched) syncTodos(core, channel, rev);
  return changed;
}

/** 打开待办时顺手同步, 最多 5 分钟一次, 不挡请求。 */
export function maybeSync(core: Core): void {
  if (!ghOn(core) || !core.gh.auth() || Date.now() - last < SYNC_GAP) return;
  last = Date.now();
  syncTodoIssues(core).catch((e) => console.error("待办 issue 同步失败:", e));
}

/** GitHub webhook 的 issues / issue_comment 事件: 只同步涉及的那一条。 */
export function onGithubHook(core: Core, kind: string, body: unknown): void {
  if (kind !== "issues" && kind !== "issue_comment") return;
  const b = body as { repository?: { full_name?: string }; issue?: { number?: number } };
  const repo = b.repository?.full_name;
  const n = b.issue?.number;
  if (!repo || !n) return;
  syncTodoIssues(core, new Set([`${repo.toLowerCase()}#${n}`])).catch((e) => console.error("待办 issue 同步失败:", e));
}
