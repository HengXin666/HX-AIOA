import type { GithubCiStatus, GithubOpenBranch, GithubRepoBranches } from "@hx-aioa/protocol";
import { GITHUB_USER_AGENT, GITHUB_WEB } from "../constants";
import { s } from "../adapters/types";
import { type Obj, obj } from "./map";

const GRAPHQL = "https://api.github.com/graphql";
// 每次 GraphQL 查几个仓库, 每个仓库看多少个分支; 免费计划子请求有限, 所以分批合并
const BATCH = 5;
const REFS = 40;
export const BRANCH_MAX_REPOS = 40;
const DAY_MS = 86_400_000;
const MERGED = "MERGED";
const OPEN = "OPEN";
// 发布用的孤儿分支, 跟主线没有共同历史, 不算未合入
const IGNORE = new Set(["gh-pages"]);

const q = (v: string) => JSON.stringify(v);

// Ref.compare(headRef: 默认分支): behindBy = 分支独有的提交, aheadBy = 默认分支比它多的
function part(i: number, repo: string, base: string): string {
  const [owner, name] = repo.split("/");
  return `r${i}: repository(owner: ${q(owner!)}, name: ${q(name!)}) { url defaultBranchRef { name }
    refs(refPrefix: "refs/heads/", first: ${REFS}) { nodes { name
      target { ... on Commit { committedDate author { name user { login } } } }
      compare(headRef: ${q(base)}) { aheadBy behindBy }
      associatedPullRequests(first: 1, orderBy: {field: UPDATED_AT, direction: DESC}) { nodes { number state isDraft url } } } } }`;
}

async function gql(token: string, query: string): Promise<{ data?: Record<string, unknown>; errors?: { message: string; path?: string[] }[] }> {
  const res = await fetch(GRAPHQL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json", "User-Agent": GITHUB_USER_AGENT },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`GitHub GraphQL ${res.status}`);
  return (await res.json()) as { data?: Record<string, unknown>; errors?: { message: string; path?: string[] }[] };
}

const list = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(obj) : []);

/** 把一个仓库的 refs 结果变成未合入分支, 最近提交在前。 */
export function openBranches(repo: string, raw: Obj, since: number, ci: (branch: string) => GithubCiStatus | undefined): GithubRepoBranches {
  const url = s(raw.url) || `${GITHUB_WEB}/${repo}`;
  const base = s(obj(raw.defaultBranchRef).name);
  const out: GithubOpenBranch[] = [];
  for (const n of list(obj(raw.refs).nodes)) {
    const name = s(n.name);
    const cmp = obj(n.compare);
    const ahead = Number(cmp.behindBy ?? 0);
    const t = obj(n.target);
    const at = Date.parse(s(t.committedDate)) || 0;
    const pr = list(obj(n.associatedPullRequests).nodes)[0];
    // 默认分支, 没有独有提交, PR 已合入 (squash 后提交数对不上) 的都算已合入
    if (!name || name === base || IGNORE.has(name) || ahead <= 0 || at < since || s(pr?.state) === MERGED) continue;
    const author = obj(t.author);
    const by = s(obj(author.user).login) || s(author.name);
    const b: GithubOpenBranch = { name, at, ahead, behind: Number(cmp.aheadBy ?? 0), url: `${url}/tree/${name}` };
    if (by) b.by = by;
    if (pr && s(pr.state) === OPEN) b.pr = { number: Number(pr.number), url: s(pr.url), draft: pr.isDraft === true };
    const c = ci(name);
    if (c) b.ci = c;
    out.push(b);
  }
  out.sort((a, b) => b.at - a.at);
  return { repo, url, defaultBranch: base, branches: out };
}

/** 查所有关注仓库的未合入分支; 单个仓库出错只记在它自己身上。base 是已知的默认分支名。 */
export async function fetchBranches(
  token: string,
  repos: { repo: string; base: string }[],
  days: number,
  ci: (repo: string, branch: string) => GithubCiStatus | undefined,
  now = Date.now(),
): Promise<GithubRepoBranches[]> {
  const since = now - days * DAY_MS;
  const all = repos.slice(0, BRANCH_MAX_REPOS);
  const batches: (typeof all)[] = [];
  for (let i = 0; i < all.length; i += BATCH) batches.push(all.slice(i, i + BATCH));
  const parts = await Promise.all(
    batches.map(async (b) => {
      try {
        const r = await gql(token, `query { ${b.map((x, i) => part(i, x.repo, x.base)).join("\n")} }`);
        return b.map((x, i) => {
          const raw = r.data?.[`r${i}`];
          if (!raw) {
            const err = r.errors?.find((e) => e.path?.[0] === `r${i}`)?.message ?? r.errors?.[0]?.message ?? "仓库不可见";
            return { repo: x.repo, url: `${GITHUB_WEB}/${x.repo}`, defaultBranch: x.base, branches: [], error: err };
          }
          return openBranches(x.repo, obj(raw), since, (br) => ci(x.repo, br));
        });
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        return b.map((x) => ({ repo: x.repo, url: `${GITHUB_WEB}/${x.repo}`, defaultBranch: x.base, branches: [], error }));
      }
    }),
  );
  return parts.flat();
}
