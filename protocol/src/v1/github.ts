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

// 可选仓库: GITHUB_TOKEN 能看到的仓库, tracked 表示已在 GitHub 页面里
export type GithubAvailableRepo = { repo: string; private: boolean; description?: string; pushedAt: number; tracked: boolean };
export type GithubAvailableResult = { login: string; repos: GithubAvailableRepo[] };
// PUT 整体替换关注列表
export type GithubTrackedRequest = { repos: string[] };

// 个人动态: 来自 GitHub 用户事件流, ETag 增量拉取, 保留 30 天
export const GITHUB_ACTIVITY_KINDS = ["push", "pr", "review", "issue", "comment", "create", "delete", "release", "star", "fork", "other"] as const;
export type GithubActivityKind = (typeof GITHUB_ACTIVITY_KINDS)[number];
export type GithubActivityItem = { id: string; ts: number; kind: GithubActivityKind; repo: string; title: string; url: string; commits?: number };
export type GithubActivityStats = { pushes: number; commits: number; prs: number; issues: number; comments: number; repos: number };
export type GithubActivityResult = { login: string; since: number; until: number; items: GithubActivityItem[]; stats: GithubActivityStats; syncedAt?: number };
