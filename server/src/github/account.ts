import type { GithubActivityItem, GithubAvailableRepo } from "@hx-aioa/protocol";
import { s } from "../adapters/types";
import { GITHUB_API, GITHUB_USER_AGENT } from "../constants";
import { activityOf } from "./activity";
import { obj } from "./map";

const PER_PAGE = 100;
const MAX_REPO_PAGES = 3;

type GhRes = { status: number; etag: string | null; body: unknown };

async function gh(token: string, path: string, etag?: string): Promise<GhRes> {
  const res = await fetch(GITHUB_API + path, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": GITHUB_USER_AGENT,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(etag ? { "If-None-Match": etag } : {}),
    },
  });
  if (res.status === 304) return { status: 304, etag: etag ?? null, body: null };
  if (!res.ok) throw new Error(`GitHub ${res.status} ${path}`);
  return { status: res.status, etag: res.headers.get("ETag"), body: await res.json() };
}

export async function fetchLogin(token: string): Promise<string> {
  const login = s(obj((await gh(token, "/user")).body).login);
  if (!login) throw new Error("GitHub /user 没有返回 login");
  return login;
}

// token 能看到的全部仓库, 最近推送的在前; 最多 300 个
export async function fetchAvailable(token: string): Promise<Omit<GithubAvailableRepo, "tracked">[]> {
  const out: Omit<GithubAvailableRepo, "tracked">[] = [];
  for (let page = 1; page <= MAX_REPO_PAGES; page += 1) {
    const list = (await gh(token, `/user/repos?per_page=${PER_PAGE}&page=${page}&sort=pushed`)).body;
    if (!Array.isArray(list)) break;
    for (const raw of list) {
      const r = obj(raw);
      const repo = s(r.full_name);
      if (!repo) continue;
      const item: Omit<GithubAvailableRepo, "tracked"> = { repo, private: r.private === true, pushedAt: Date.parse(s(r.pushed_at)) || 0 };
      const d = s(r.description);
      if (d) item.description = d;
      out.push(item);
    }
    if (list.length < PER_PAGE) break;
  }
  return out;
}

// 用户事件流带 ETag: 没有新事件时 GitHub 回 304, 不计入速率限制
export async function fetchActivity(token: string, login: string, etag?: string): Promise<{ items: GithubActivityItem[]; etag?: string } | null> {
  const r = await gh(token, `/users/${encodeURIComponent(login)}/events?per_page=${PER_PAGE}`, etag);
  if (r.status === 304) return null;
  const items = (Array.isArray(r.body) ? r.body : []).map((e) => activityOf(obj(e))).filter((x): x is GithubActivityItem => x !== null);
  return r.etag ? { items, etag: r.etag } : { items };
}

