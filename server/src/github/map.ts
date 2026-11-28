import type { GithubCiStatus, GithubIssue, GithubPr, GithubRun } from "@hx-aioa/protocol";
import { GITHUB_SUBJECT_PREFIX } from "../constants";
import { isObj, s } from "../adapters/types";

export type Obj = Record<string, unknown>;

export const obj = (v: unknown): Obj => (isObj(v) ? v : {});
export const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

const REPO_RE = /^([\w.-]+)\/([\w.-]+)$/;

// "github:owner/repo" 或 "owner/repo" -> owner/repo, 其他形式返回 null
export function repoOfSubject(subject: string | undefined): string | null {
  const raw = (subject ?? "").trim();
  const v = raw.startsWith(GITHUB_SUBJECT_PREFIX) ? raw.slice(GITHUB_SUBJECT_PREFIX.length) : raw;
  return REPO_RE.test(v) ? v : null;
}

export type ForkInfo = { fork?: boolean; parent?: string };

/** fork 标识 (#144): REST 给 fork + parent.full_name, GraphQL 给 isFork + parent.nameWithOwner; 自建的返回空对象。 */
export function forkOf(repo: Obj): ForkInfo {
  if (repo.fork !== true && repo.isFork !== true) return {};
  const p = obj(repo.parent);
  const parent = s(p.full_name) || s(p.nameWithOwner);
  return parent ? { fork: true, parent } : { fork: true };
}

export function msOf(v: unknown, fallback: number): number {
  const t = typeof v === "string" ? Date.parse(v) : Number.NaN;
  return Number.isFinite(t) ? t : fallback;
}

const RUNNING = new Set(["queued", "in_progress", "requested", "waiting", "pending"]);
const SUCCESS = new Set(["success", "skipped", "neutral"]);
const FAILURE = new Set(["failure", "timed_out", "startup_failure", "action_required"]);

export function ciStatus(status: string, conclusion: string): GithubCiStatus {
  if (RUNNING.has(status)) return "running";
  if (SUCCESS.has(conclusion)) return "success";
  if (FAILURE.has(conclusion)) return "failure";
  if (conclusion === "cancelled") return "cancelled";
  return "unknown";
}

export function prOf(pr: Obj, now: number): GithubPr {
  return {
    number: num(pr.number) ?? 0,
    title: s(pr.title),
    author: s(obj(pr.user).login),
    url: s(pr.html_url),
    draft: pr.draft === true,
    updatedAt: msOf(pr.updated_at, now),
  };
}

export function issueOf(issue: Obj, now: number): GithubIssue {
  const labels = Array.isArray(issue.labels) ? issue.labels.map((l) => (typeof l === "string" ? l : s(obj(l).name))).filter(Boolean) : [];
  return {
    number: num(issue.number) ?? 0,
    title: s(issue.title),
    author: s(obj(issue.user).login),
    url: s(issue.html_url),
    updatedAt: msOf(issue.updated_at, now),
    labels,
  };
}

export function runOf(run: Obj, now: number): GithubRun {
  return {
    workflow: s(run.name),
    branch: s(run.head_branch),
    status: ciStatus(s(run.status), s(run.conclusion)),
    url: s(run.html_url),
    at: msOf(run.updated_at, now),
  };
}
