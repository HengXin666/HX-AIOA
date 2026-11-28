import {
  PATH_GITHUB_ACTIVITY,
  PATH_GITHUB_BRANCHES,
  PATH_GITHUB_DAILY,
  PATH_GITHUB_HEATMAP,
  PATH_GITHUB_REPOS,
  PATH_GITHUB_TREND,
  type GithubActivityResult,
  type GithubBranchesResult,
  type GithubDailyResult,
  type GithubHeatmap,
  type GithubReposResult,
  type GithubTrendResult,
} from "@hx-aioa/protocol";
import { ComboChart, Donut, HeatCalendar } from "@hx/ui/data";
import { Badge } from "@hx/ui/ui/badge";
import { Button } from "@hx/ui/ui/button";
import { Skeleton } from "@hx/ui/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@hx/ui/ui/toggle-group";
import { ChevronRight, GitBranch, GitPullRequest, FolderGit2, LineChart, Flame } from "lucide-react";
import { useState } from "react";
import { href } from "../../app/router";
import { api } from "../../core/auth";
import { EXTERNAL } from "../../core/constants";
import { localTimeZone } from "@hx-aioa/protocol";
import { shortTime } from "../ChatList";
import { useOnce } from "../resources/useOnce";
import { Feat, Panel, Quiet, TONE } from "./parts";

const DAY_MS = 86_400_000;
const FRESH_DAYS = [3, 14];
const KIND: Record<string, string> = { push: "推送", pr: "PR", review: "评审", issue: "Issue", comment: "评论", create: "新建", delete: "删除", release: "发布", star: "Star", fork: "Fork", other: "其他" };
const tzMin = () => -new Date().getTimezoneOffset();
const startOfToday = () => new Date(new Date().setHours(0, 0, 0, 0)).getTime();
const short = (label: string) => label.slice(5).replace("-", "/");

// "开发" 看板 (对照安卓 Boards.DevBoard + GithubCard / GithubHeat / GithubTrendCard / GithubBranchBoard / GithubMine)
export function DevBoard() {
  const tz = encodeURIComponent(localTimeZone());
  const repos = useOnce("gh-repos", () => api<GithubReposResult>(PATH_GITHUB_REPOS));
  const daily = useOnce("gh-daily", () => api<GithubDailyResult>(`${PATH_GITHUB_DAILY}?days=14&tz=${tzMin()}`));
  const heat = useOnce("gh-heat", () => api<GithubHeatmap>(`${PATH_GITHUB_HEATMAP}?tz=${tz}`));
  const trend = useOnce("gh-trend", () => api<GithubTrendResult>(`${PATH_GITHUB_TREND}?tz=${tz}`));
  const act = useOnce("gh-act", () => api<GithubActivityResult>(`${PATH_GITHUB_ACTIVITY}?since=${startOfToday()}`));
  const branches = useOnce("gh-branches", () => api<GithubBranchesResult>(PATH_GITHUB_BRANCHES));
  if (repos.status === 404 || repos.status === 403) return <Quiet icon={<FolderGit2 />}>GitHub 插件没有启用, 主人在 我的 → 插件 里启用后这里显示仓库, 提交与 PR</Quiet>;
  const today = daily.data?.days.at(-1);
  const rs = repos.data?.repos ?? [];
  const ciFail = rs.filter((r) => r.ci?.status === "failure").length;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      <Panel
        title="GitHub"
        icon={<FolderGit2 />}
        count={rs.length}
        hint={daily.data ? `@${daily.data.login}` : "关注的仓库"}
        className="lg:col-span-5"
        action={
          <Button asChild size="xs" variant="ghost">
            <a href={href({ name: "res", tab: "gh" })}>
              全部
              <ChevronRight />
            </a>
          </Button>
        }
      >
        <div className="grid grid-cols-2 gap-2">
          <Feat value={today?.commits ?? "-"} label="今天提交" color={TONE.primary} />
          <Feat value={daily.data?.streak ?? "-"} label="天连续提交" color={TONE.warning} />
          <Feat value={daily.data?.openPrs ?? rs.reduce((n, r) => n + r.openPrs, 0)} label="开着的 PR" color={TONE.accent} />
          <Feat value={ciFail} label="CI 失败的仓库" color={ciFail ? TONE.danger : TONE.muted} />
        </div>
        {act.data?.items.slice(0, 5).map((it) => (
          <a key={it.id} href={it.url} {...EXTERNAL} className="flex items-center gap-2 rounded-md px-1 py-1 text-xs hover:bg-muted">
            <Badge variant="secondary">{KIND[it.kind] ?? it.kind}</Badge>
            <span className="min-w-0 flex-1 truncate text-foreground">{it.title}</span>
            <span className="shrink-0 text-muted-foreground">{shortTime(it.ts)}</span>
          </a>
        ))}
        {act.data && !act.data.items.length && <p className="text-xs text-muted-foreground">今天还没有 GitHub 动态</p>}
      </Panel>
      <Panel title="提交热力" icon={<Flame />} hint={heat.data ? `最近 ${heat.data.days.length} 天 ${heat.data.days.reduce((n, d) => n + d.commits, 0)} 次提交` : undefined} className="lg:col-span-7">
        <div className="flex flex-wrap items-center gap-6">
          <div className="min-w-0 flex-1">
            {heat.data ? (
              <HeatCalendar values={Object.fromEntries(heat.data.days.map((d) => [d.date, d.commits]))} weeks={Math.ceil(heat.data.days.length / 7)} unit="次提交" color={TONE.success} />
            ) : (
              <Skeleton className="h-32 w-full" />
            )}
          </div>
          {act.data && act.data.stats.pushes + act.data.stats.prs + act.data.stats.issues + act.data.stats.comments > 0 && (
            <Donut
              size={150}
              center={String(act.data.stats.commits)}
              centerLabel="今天提交"
              data={[
                { key: "push", label: "推送", value: act.data.stats.pushes, color: TONE.primary },
                { key: "pr", label: "PR", value: act.data.stats.prs, color: TONE.accent },
                { key: "issue", label: "Issue", value: act.data.stats.issues, color: TONE.warning },
                { key: "comment", label: "评论", value: act.data.stats.comments, color: TONE.success },
              ]}
            />
          )}
        </div>
      </Panel>
      <Trend data={trend.data} className="lg:col-span-12" />
      <Branches data={branches.data} error={branches.error} className="lg:col-span-12" />
    </div>
  );
}

function Trend({ data, className }: { data: GithubTrendResult | null; className: string }) {
  const [span, setSpan] = useState<"days" | "weeks">("days");
  const pts = data?.[span].points ?? [];
  const rows = pts.map((p) => ({ label: short(p.label), commits: p.commits, pr: p.prOpened + p.prMerged, issue: p.issueOpened + p.issueClosed, talk: p.prComments + p.issueComments + p.reviews }));
  return (
    <Panel
      title="走势"
      icon={<LineChart />}
      hint={data ? `收到评论 ${data[span].received} 条` : undefined}
      className={className}
      action={
        <ToggleGroup type="single" size="sm" variant="outline" value={span} onValueChange={(v) => v && setSpan(v as "days" | "weeks")}>
          <ToggleGroupItem value="days">14 天</ToggleGroupItem>
          <ToggleGroupItem value="weeks">12 周</ToggleGroupItem>
        </ToggleGroup>
      }
    >
      {!data ? (
        <Skeleton className="h-56 w-full" />
      ) : (
        <ComboChart
          data={rows}
          x="label"
          bars={[{ key: "commits", label: "提交", color: TONE.primary }]}
          lines={[
            { key: "pr", label: "PR", color: TONE.accent },
            { key: "issue", label: "Issue", color: TONE.warning },
            { key: "talk", label: "评论与评审", color: TONE.success },
          ]}
          height={240}
        />
      )}
    </Panel>
  );
}

// 未合入分支 (对照安卓 GithubBranchBoard): 新鲜度三段 + 每个仓库列几条
function Branches({ data, error, className }: { data: GithubBranchesResult | null; error: string | null; className: string }) {
  const all = data?.repos.flatMap((r) => r.branches.map((b) => ({ ...b, repo: r.repo }))) ?? [];
  const now = Date.now();
  const age = (at: number) => (now - at) / DAY_MS;
  const fresh = all.filter((b) => age(b.at) <= FRESH_DAYS[0]!).length;
  const mid = all.filter((b) => age(b.at) > FRESH_DAYS[0]! && age(b.at) <= FRESH_DAYS[1]!).length;
  const stale = all.length - fresh - mid;
  return (
    <Panel title="未合入的分支" icon={<GitBranch />} count={all.length} hint={data ? `最近 ${data.days} 天有提交` : undefined} className={className}>
      {error && <p className="text-xs text-muted-foreground">{error}</p>}
      {!data && !error && <Skeleton className="h-20 w-full" />}
      {data && !all.length && <Quiet icon={<GitPullRequest />}>分支都合进去了</Quiet>}
      {all.length > 0 && (
        <>
          <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
            {[
              [fresh, TONE.success],
              [mid, TONE.warning],
              [stale, TONE.muted],
            ].map(([n, c], i) => (
              <div key={i} style={{ width: `${((n as number) / all.length) * 100}%`, background: c as string }} />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            3 天内 {fresh} · 两周内 {mid} · 更早 {stale}
          </p>
          <div className="grid gap-x-6 gap-y-1 md:grid-cols-2">
            {all.slice(0, 10).map((b) => (
              <a key={`${b.repo}:${b.name}`} href={b.url} {...EXTERNAL} className="flex items-center gap-2 rounded-md px-1 py-1 text-xs hover:bg-muted">
                <span className="size-2 shrink-0 rounded-full" style={{ background: b.ci === "failure" ? TONE.danger : age(b.at) <= 3 ? TONE.success : age(b.at) <= 14 ? TONE.warning : TONE.muted }} />
                <span className="truncate font-medium text-foreground">{b.name}</span>
                <span className="truncate text-muted-foreground">{b.repo.split("/")[1]}</span>
                <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">
                  +{b.ahead} -{b.behind}
                  {b.pr ? ` #${b.pr.number}` : ""} · {shortTime(b.at)}
                </span>
              </a>
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}
