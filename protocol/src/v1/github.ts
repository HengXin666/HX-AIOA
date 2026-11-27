// GitHub 接入是 L2a 插件: 代码随部署发布, 主人启用后接口, webhook 入库, 定时回填才生效
export const GITHUB_PLUGIN = "hengxin666.github";

// GitHub 页面: 仓库摘要与详情, 由 webhook 增量维护, 可用 GITHUB_TOKEN 回填。时间字段都是毫秒时间戳
export const GITHUB_CI_STATUSES = ["success", "failure", "running", "cancelled", "unknown"] as const;
export type GithubCiStatus = (typeof GITHUB_CI_STATUSES)[number];

export const GITHUB_TIMELINE_KINDS = ["push", "pr", "issue", "ci", "release", "star", "comment"] as const;
export type GithubTimelineKind = (typeof GITHUB_TIMELINE_KINDS)[number];

export type GithubPush = { at: number; by: string; branch: string; commits: number; sha?: string };
// 仓库详情里的活跃分支: 按最近推送倒序, ci 是该分支最近一次 CI 的结果
export type GithubBranch = GithubPush & { ci?: GithubCiStatus };
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
  // webhook 收到过推送的分支, 最近的在前, 最多 GITHUB_BRANCHES 个
  branches?: GithubBranch[];
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
// action: PR / Issue 的动作 (opened / closed / merged / reopened), 旧数据没有时按标题推断
export type GithubActivityItem = { id: string; ts: number; kind: GithubActivityKind; repo: string; title: string; url: string; commits?: number; action?: string };
export type GithubActivityStats = { pushes: number; commits: number; prs: number; issues: number; comments: number; repos: number };
// 每日统计: 柱状图用, day 是客户端时区的日期 (YYYY-MM-DD), start 为当天零点
export type GithubDay = {
  day: string;
  start: number;
  commits: number;
  pushes: number;
  prOpened: number;
  prMerged: number;
  prClosed: number;
  issueOpened: number;
  issueClosed: number;
  reviews: number;
  comments: number;
};
// open*: 关注的仓库当前还开着的 PR / Issue; streak: 截至今天连续有动态的天数
export type GithubDailyResult = { login: string; days: GithubDay[]; openPrs: number; openIssues: number; streak: number; syncedAt?: number };
export const GITHUB_DAILY_DEFAULT_DAYS = 14;
export const GITHUB_DAILY_MAX_DAYS = 30;

export type GithubActivityResult = { login: string; since: number; until: number; items: GithubActivityItem[]; stats: GithubActivityStats; syncedAt?: number };

// 未合入分支: 有自己的提交 (ahead > 0), 没删, 也没通过 PR 合入; behind 是落后默认分支的提交数
export type GithubOpenBranch = {
  name: string;
  at: number;
  by?: string;
  ahead: number;
  behind: number;
  url: string;
  pr?: { number: number; url: string; draft: boolean };
  ci?: GithubCiStatus;
};
export type GithubRepoBranches = { repo: string; url: string; defaultBranch: string; branches: GithubOpenBranch[]; error?: string };
// days: 只算最近 days 天有提交的分支; 全局视图与单仓库共用
export type GithubBranchesResult = { at: number; days: number; repos: GithubRepoBranches[] };
export const GITHUB_BRANCH_DEFAULT_DAYS = 30;
export const GITHUB_BRANCH_MAX_DAYS = 90;

// 提交热力图 (#134): 最近 GITHUB_HEATMAP_DAYS 天每天的提交数, 按主人时区的日期; 每天 cron 累计存一行
export type GithubHeatDay = { date: string; commits: number };
export type GithubHeatmap = { days: GithubHeatDay[]; updated: number };
export const GITHUB_HEATMAP_DAYS = 140;
