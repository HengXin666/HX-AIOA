import {
  GITHUB_HISTORY_KINDS,
  PATH_GITHUB_HEATMAP,
  PATH_GITHUB_HISTORY,
  PATH_GITHUB_REPO,
  PATH_GITHUB_REPOS,
  QUERY_BEFORE,
  QUERY_KIND,
  type GithubCiStatus,
  type GithubHeatmap,
  type GithubHistoryItem,
  type GithubHistoryKind,
  type GithubHistoryResult,
  type GithubRepoDetail,
  type GithubRepoSummary,
  type GithubReposResult,
} from "@hx-aioa/protocol";
import { Badge } from "@hx/ui/ui/badge";
import { Button } from "@hx/ui/ui/button";
import { ArrowLeft, CircleDot, ExternalLink, GitPullRequest, Star } from "lucide-react";
import { useEffect, useState } from "react";
import { go, href } from "../../app/router";
import { api, fill } from "../../core/auth";
import { EXTERNAL, TXT_LOAD_MORE, TXT_LOADING } from "../../core/constants";
import { Heatmap } from "../../charts/svg";
import { shortTime } from "../ChatList";
import { useOnce } from "./useOnce";

const CI_DOT: Record<GithubCiStatus, "success" | "destructive" | "info" | "muted"> = { success: "success", failure: "destructive", running: "info", cancelled: "muted", unknown: "muted" };
const CI_TEXT: Record<GithubCiStatus, string> = { success: "通过", failure: "失败", running: "运行中", cancelled: "取消", unknown: "未知" };
const KIND_TEXT: Record<GithubHistoryKind, string> = { commit: "提交", pr: "PR", issue: "Issue", release: "发布" };
const NOT_ENABLED = 404;

export function GithubPage({ repo }: { repo?: string }) {
  return <div className="h-full overflow-y-auto">{repo ? <RepoDetail key={repo} repo={repo} /> : <RepoList />}</div>;
}

function RepoList() {
  const repos = useOnce("repos", () => api<GithubReposResult>(PATH_GITHUB_REPOS));
  const heat = useOnce("heat", () => api<GithubHeatmap>(PATH_GITHUB_HEATMAP));
  if (repos.status === NOT_ENABLED) return <p className="p-6 text-sm text-muted-foreground">GitHub 插件没有启用 (主人在安卓 App 的插件里启用)。</p>;
  const total = heat.data?.days.reduce((n, d) => n + d.commits, 0) ?? 0;
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4">
      {heat.data && heat.data.days.length > 0 && (
        <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3">
          <h3 className="text-sm font-medium text-foreground">
            提交热力格 <span className="text-xs text-muted-foreground">最近 {heat.data.days.length} 天 {total} 次提交</span>
          </h3>
          <div className="overflow-x-auto">
            <Heatmap days={heat.data.days} />
          </div>
        </section>
      )}
      {repos.busy && <p className="text-sm text-muted-foreground">{TXT_LOADING}</p>}
      {repos.error && <p className="text-sm text-destructive">{repos.error}</p>}
      {repos.data && !repos.data.synced && <p className="text-xs text-muted-foreground">服务端没有用 GITHUB_TOKEN 回填过, 数据只来自 webhook, PR / Issue 可能不全。</p>}
      <ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
        {repos.data?.repos.map((r) => <RepoCard key={r.repo} r={r} />)}
      </ul>
      {repos.data && !repos.data.repos.length && <p className="text-sm text-muted-foreground">还没有关注的仓库。</p>}
    </div>
  );
}

function RepoCard({ r }: { r: GithubRepoSummary }) {
  return (
    <li>
      <a href={href({ name: "res", tab: "gh", id: r.repo })} className="flex h-full flex-col gap-2 rounded-xl border border-border bg-card p-3 hover:bg-muted">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{r.repo}</span>
          {r.fork && <Badge variant="secondary">fork</Badge>}
          {r.ci && (
            <Badge variant="outline" dot={CI_DOT[r.ci.status]}>
              {CI_TEXT[r.ci.status]}
            </Badge>
          )}
        </div>
        {r.description && <p className="line-clamp-2 text-xs text-muted-foreground">{r.description}</p>}
        <div className="mt-auto flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Star className="size-3" />
            {r.stars}
          </span>
          <span className="flex items-center gap-1">
            <GitPullRequest className="size-3" />
            {r.openPrs}
          </span>
          <span className="flex items-center gap-1">
            <CircleDot className="size-3" />
            {r.openIssues}
          </span>
          {r.lastPush && (
            <span className="ml-auto truncate">
              {r.lastPush.branch} · {shortTime(r.lastPush.at)}
            </span>
          )}
        </div>
      </a>
    </li>
  );
}

function RepoDetail({ repo }: { repo: string }) {
  const [owner, name] = repo.split("/");
  const d = useOnce(repo, () => api<GithubRepoDetail>(fill(PATH_GITHUB_REPO, owner ?? "", name ?? "")));
  const r = d.data?.repo;
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-4">
      <header className="flex items-center gap-2">
        <Button size="icon-sm" variant="ghost" aria-label="返回" onClick={() => go({ name: "res", tab: "gh" })}>
          <ArrowLeft />
        </Button>
        <h3 className="min-w-0 flex-1 truncate text-base font-semibold text-foreground">{repo}</h3>
        {r && (
          <Button asChild size="sm" variant="ghost">
            <a href={r.url} {...EXTERNAL}>
              <ExternalLink />
              GitHub
            </a>
          </Button>
        )}
      </header>
      {d.busy && <p className="text-sm text-muted-foreground">{TXT_LOADING}</p>}
      {d.error && <p className="text-sm text-destructive">{d.error}</p>}
      {d.data && (
        <div className="grid gap-4 md:grid-cols-2">
          <Links title={`开着的 PR (${d.data.prs.length})`} items={d.data.prs.map((p) => ({ key: `pr${p.number}`, title: `#${p.number} ${p.title}`, sub: `${p.author} · ${shortTime(p.updatedAt)}`, url: p.url }))} />
          <Links title={`开着的 Issue (${d.data.issues.length})`} items={d.data.issues.map((p) => ({ key: `is${p.number}`, title: `#${p.number} ${p.title}`, sub: `${p.author} · ${shortTime(p.updatedAt)}`, url: p.url }))} />
          <Links title="最近 CI" items={d.data.runs.map((x, i) => ({ key: `ci${i}`, title: `${x.workflow} · ${CI_TEXT[x.status]}`, sub: `${x.branch} · ${shortTime(x.at)}`, url: x.url }))} />
          <Links title="动态" items={d.data.timeline.map((x, i) => ({ key: `tl${i}`, title: x.title, sub: shortTime(x.ts), url: x.url }))} />
        </div>
      )}
      <History owner={owner ?? ""} name={name ?? ""} />
    </div>
  );
}

type LinkRow = { key: string; title: string; sub: string; url: string };

function Links({ title, items }: { title: string; items: LinkRow[] }) {
  return (
    <section className="flex flex-col gap-1 rounded-xl border border-border bg-card p-3">
      <h4 className="mb-1 text-sm font-medium text-foreground">{title}</h4>
      {!items.length && <p className="text-xs text-muted-foreground">暂无</p>}
      {items.slice(0, 10).map((x) => (
        <a key={x.key} href={x.url} {...EXTERNAL} className="rounded-md px-1 py-1 hover:bg-muted">
          <span className="block truncate text-sm text-foreground">{x.title}</span>
          <span className="block truncate text-xs text-muted-foreground">{x.sub}</span>
        </a>
      ))}
    </section>
  );
}

// 仓库历史: 进页取第一页, "更早的" 由用户点了再翻
function History({ owner, name }: { owner: string; name: string }) {
  const [kind, setKind] = useState<GithubHistoryKind>("commit");
  const [items, setItems] = useState<GithubHistoryItem[]>([]);
  const [next, setNext] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (k: GithubHistoryKind, before?: string) => {
    setBusy(true);
    setError(null);
    try {
      const q = `${QUERY_KIND}=${k}${before ? `&${QUERY_BEFORE}=${encodeURIComponent(before)}` : ""}`;
      const r = await api<GithubHistoryResult>(`${fill(PATH_GITHUB_HISTORY, owner, name)}?${q}`);
      setItems((old) => {
        const all = before ? [...old, ...r.items] : r.items;
        return [...new Map(all.map((x) => [x.id, x])).values()];
      });
      setNext(r.next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    setItems([]);
    void load(kind);
    // 换类别才重取
  }, [kind, owner, name]);

  return (
    <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3">
      <div className="flex items-center gap-1">
        <h4 className="mr-2 text-sm font-medium text-foreground">历史</h4>
        {GITHUB_HISTORY_KINDS.map((k) => (
          <Button key={k} size="xs" variant={k === kind ? "secondary" : "ghost"} onClick={() => setKind(k)}>
            {KIND_TEXT[k]}
          </Button>
        ))}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <ul className="flex flex-col">
        {items.map((x) => (
          <li key={x.id}>
            <a href={x.url} {...EXTERNAL} className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-muted">
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                {x.number ? `#${x.number} ` : ""}
                {x.title}
              </span>
              {x.state && <Badge variant="outline">{x.state}</Badge>}
              <span className="shrink-0 text-xs text-muted-foreground">
                {x.by ? `${x.by} · ` : ""}
                {shortTime(x.ts)}
              </span>
            </a>
          </li>
        ))}
      </ul>
      {busy && <p className="text-xs text-muted-foreground">{TXT_LOADING}</p>}
      {!busy && next && (
        <Button size="sm" variant="ghost" onClick={() => void load(kind, next)}>
          {TXT_LOAD_MORE}
        </Button>
      )}
      {!busy && !next && items.length > 0 && <p className="text-center text-xs text-muted-foreground">已到最早一条</p>}
    </section>
  );
}
