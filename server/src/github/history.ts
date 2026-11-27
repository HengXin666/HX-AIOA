import { GITHUB_HISTORY_PAGE, type GithubHistoryItem, type GithubHistoryKind, type GithubHistoryResult } from "@hx-aioa/protocol";
import { s } from "../adapters/types";
import { type Obj, num, obj } from "./map";
import { type RestRes, isoSec, restGet } from "./rest";

const SEC = 1000;
const HOUR_MS = 3600_000;
const FRESH_MS = 5 * 60_000;
const SETTLED_MS = 24 * HOUR_MS;
const OLD_MS = 7 * 24 * HOUR_MS;
const SHA_SHORT = 7;
const MERGED = "merged";
const RATE_LIMITED = new Set([403, 429]);

export class HistoryFail extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const tsOf = (v: unknown) => Date.parse(s(v)) || 0;
const list = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(obj) : []);

function withBy(item: GithubHistoryItem, by: string): GithubHistoryItem {
  if (by) item.by = by;
  return item;
}

export function commitItem(c: Obj): GithubHistoryItem | null {
  const sha = s(c.sha);
  if (!sha) return null;
  const commit = obj(c.commit);
  const author = obj(commit.author);
  const title = s(commit.message).split("\n")[0] || sha.slice(0, SHA_SHORT);
  const item: GithubHistoryItem = { id: sha, ts: tsOf(author.date) || tsOf(obj(commit.committer).date), kind: "commit", title, url: s(c.html_url) };
  return withBy(item, s(obj(c.author).login) || s(author.name));
}

/** 搜索结果里的 PR / Issue; PR 有 merged_at 时状态记为 merged。 */
export function issueItem(i: Obj, kind: "pr" | "issue"): GithubHistoryItem | null {
  const n = num(i.number);
  if (!n) return null;
  const merged = s(obj(i.pull_request).merged_at) !== "";
  const item: GithubHistoryItem = { id: `${kind}${n}`, ts: tsOf(i.created_at), kind, title: s(i.title), url: s(i.html_url), number: n, state: merged ? MERGED : s(i.state) };
  return withBy(item, s(obj(i.user).login));
}

export function releaseItem(r: Obj): GithubHistoryItem | null {
  const id = s(r.id);
  if (!id) return null;
  const item: GithubHistoryItem = { id: `rel${id}`, ts: tsOf(r.published_at) || tsOf(r.created_at), kind: "release", title: s(r.name) || s(r.tag_name), url: s(r.html_url) };
  return withBy(item, s(obj(r.author).login));
}

const notNull = <T>(x: T | null): x is T => x !== null;

/** 一页的路径: 提交按 until 往前翻, PR / Issue 用搜索按创建时间往前翻, 发布按页码。 */
export function historyPath(repo: string, kind: GithubHistoryKind, before: string): string {
  const n = Number(before);
  if (kind === "commit") return `/repos/${repo}/commits?per_page=${GITHUB_HISTORY_PAGE}${n ? `&until=${isoSec(n - SEC)}` : ""}`;
  if (kind === "release") return `/repos/${repo}/releases?per_page=${GITHUB_HISTORY_PAGE}&page=${n || 1}`;
  const q = `repo:${repo} is:${kind}${n ? ` created:<${isoSec(n)}` : ""}`;
  return `/search/issues?q=${encodeURIComponent(q)}&sort=created&order=desc&per_page=${GITHUB_HISTORY_PAGE}`;
}

/** 历史页的缓存时长: 最新一页短, 游标早于一天的历史页长; 发布按页码, 只给短缓存。 */
export function historyTtl(kind: GithubHistoryKind, before: string, now: number): number {
  const n = Number(before);
  if (!n || kind === "release") return n > 1 ? HOUR_MS : FRESH_MS;
  return now - n > SETTLED_MS ? OLD_MS : FRESH_MS;
}

export function historyOf(repo: string, kind: GithubHistoryKind, before: string, r: RestRes): GithubHistoryResult {
  const raw = kind === "pr" || kind === "issue" ? list(obj(r.body).items) : list(r.body);
  const items = raw.map((x) => (kind === "commit" ? commitItem(x) : kind === "release" ? releaseItem(x) : issueItem(x, kind))).filter(notNull);
  const out: GithubHistoryResult = { repo, kind, items };
  if (raw.length < GITHUB_HISTORY_PAGE) return out;
  if (kind === "release") out.next = String((Number(before) || 1) + 1);
  else {
    // 提交的 until 按提交者时间过滤, 游标也取提交者时间, rebase 过的提交不会漏
    const tail = obj(raw.at(-1));
    const at = kind === "commit" ? tsOf(obj(obj(tail.commit).committer).date) : tsOf(tail.created_at);
    if (at > 0) out.next = String(at);
  }
  return out;
}

export async function fetchHistory(token: string, repo: string, kind: GithubHistoryKind, before: string): Promise<GithubHistoryResult> {
  const r = await restGet(token, historyPath(repo, kind, before));
  if (RATE_LIMITED.has(r.status)) throw new HistoryFail(429, "GitHub 速率限制, 稍后再试");
  if (!r.ok) throw new HistoryFail(r.status === 404 ? 404 : 502, `GitHub ${r.status}`);
  return historyOf(repo, kind, before, r);
}
