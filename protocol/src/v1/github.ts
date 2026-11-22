// GitHub 页面: 仓库摘要与详情, 由 webhook 增量维护, 可用 GITHUB_TOKEN 回填。时间字段都是毫秒时间戳
export const GITHUB_CI_STATUSES = ["success", "failure", "running", "cancelled", "unknown"] as const;
export type GithubCiStatus = (typeof GITHUB_CI_STATUSES)[number];

export const GITHUB_TIMELINE_KINDS = ["push", "pr", "issue", "ci", "release", "star", "comment"] as const;
export type GithubTimelineKind = (typeof GITHUB_TIMELINE_KINDS)[number];

export type GithubPush = { at: number; by: string; branch: string; commits: number };
export type GithubCi = { status: GithubCiStatus; workflow: string; branch: string; url: string; at: number };

export type GithubRepoSummary = {
  repo: string;
  url: string;
  description?: string;
  stars: number;
  openPrs: number;
  openIssues: number;
  defaultBranch?: string;
  lastPush?: GithubPush;
  ci?: GithubCi;
  updatedAt: number;
};

export type GithubPr = { number: number; title: string; author: string; url: string; draft: boolean; updatedAt: number };
export type GithubIssue = { number: number; title: string; author: string; url: string; updatedAt: number; labels: string[] };
export type GithubRun = { workflow: string; branch: string; status: GithubCiStatus; url: string; at: number };
export type GithubTimelineItem = { ts: number; kind: GithubTimelineKind; title: string; url: string };

export type GithubRepoDetail = {
  repo: GithubRepoSummary;
  prs: GithubPr[];
  issues: GithubIssue[];
  runs: GithubRun[];
  timeline: GithubTimelineItem[];
};

export type GithubReposResult = { repos: GithubRepoSummary[]; synced: boolean };
export type GithubSyncResult = { ok: boolean; repos: number; error?: string };
