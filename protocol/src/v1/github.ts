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

// 提交热力图 (#134): 不带 year 时为最近 GITHUB_HEATMAP_DAYS 天, 带 year 时为该年 1 月 1 日到年底 (今年到今天); 按主人时区的日期
export type GithubHeatDay = { date: string; commits: number };
// 历史回填进度: repos 为关注的仓库数, pending 为全部历史还没拉完的; oldest 为有提交数据的最早一天
export type GithubHeatBackfill = { done: boolean; repos: number; pending: number; oldest?: string };
// years: 有数据的年份 (含今年), 新的在前
export type GithubHeatmap = { days: GithubHeatDay[]; updated: number; year?: number; years?: number[]; backfill?: GithubHeatBackfill };
export const GITHUB_HEATMAP_DAYS = 140;

// 仓库历史 (#134): 服务端代理 GitHub 分页, 按页缓存, 不落库; next 原样作为下一次的 before, 没有表示到头了
export const GITHUB_HISTORY_KINDS = ["commit", "pr", "issue", "release"] as const;
export type GithubHistoryKind = (typeof GITHUB_HISTORY_KINDS)[number];
// state: PR 为 open / closed / merged, Issue 为 open / closed
export type GithubHistoryItem = { id: string; ts: number; kind: GithubHistoryKind; title: string; url: string; by?: string; number?: number; state?: string };
export type GithubHistoryResult = { repo: string; kind: GithubHistoryKind; items: GithubHistoryItem[]; next?: string };
export const GITHUB_HISTORY_PAGE = 30;

// 走势 (#142): 一个接口给 GitHub 页全部折线 / 混合图; 按天 14 格与按周 (周一起) 12 格一起给, 切范围不再请求
// label: 那一格第一天 YYYY-MM-DD (设备时区); *Comments 是我发的评论; received 是范围内我新开的 Issue / PR 收到的评论总数
export type GithubTrendPoint = {
  label: string;
  commits: number;
  prOpened: number;
  prMerged: number;
  prClosed: number;
  issueOpened: number;
  issueClosed: number;
  prComments: number;
  issueComments: number;
  reviews: number;
};
export type GithubTrendSeries = { points: GithubTrendPoint[]; received: number };
// 足迹: 我新建的仓库 (at 为创建时间) 与我 star 的仓库 (at 为 star 时间, stars 为仓库星数), 新的在前
export type GithubFootprint = { repo: string; url: string; at: number; description?: string; private?: boolean; stars?: number };
// backfill.done: Issue / PR 与评论都已补到 12 周前; syncedAt 为最近一次走势同步
export type GithubTrendResult = {
  login: string;
  days: GithubTrendSeries;
  weeks: GithubTrendSeries;
  created: GithubFootprint[];
  starred: GithubFootprint[];
  backfill: { done: boolean };
  syncedAt?: number;
};
export const GITHUB_TREND_DAYS = 14;
export const GITHUB_TREND_WEEKS = 12;
