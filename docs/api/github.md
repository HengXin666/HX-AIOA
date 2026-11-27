# GitHub 页面接口 (v1)

服务端与安卓共用的约定, 类型见 `protocol/src/v1/github.ts`, 路径常量 `PATH_GITHUB_REPOS`, `PATH_GITHUB_REPO`, `PATH_GITHUB_SYNC`。时间字段都是毫秒时间戳。

## 插件门控

GitHub 接入是内置插件 `hengxin666.github` (清单 `plugins/hengxin666.github/plugin.json`, 接口见 `docs/api/plugins.md`)。主人启用时下面一切照旧; 主人停用后:

- 本页全部接口返回 404, 带 `events:read` 的云 Agent key 也是 404。云 Agent 读 GitHub 需要 `events:read` 且主人启用了本插件。
- `POST /api/v1/hooks/github/{keyId}` 返回 404, 不入库也不进消息流 (GitHub 那边显示投递失败); 要彻底不发, 在仓库设置里删掉 webhook。
- cron 照常调到 Hub, 但不回填 (不发 GitHub 子请求, 不写库)。
- 数据保留, 再启用即恢复; 停用时带 `?purge=1` 清空全部 `gh_*` 表与关注列表, 登录名, 同步时间。
- 升级前的部署第一次唤醒时自动放行并为主人启用, 行为不变。

## 接口

- `GET /api/v1/github/repos` (owner 或 `events:read`) -> `GithubReposResult`
  - `{ repos: GithubRepoSummary[], synced: boolean }`, 按 `updatedAt` 倒序。
  - 摘要: `{ repo, url, description?, stars, openPrs, openIssues, defaultBranch?, lastPush?: { at, by, branch, commits, sha? }, ci?: { status, workflow, branch, url, at }, updatedAt }`。
  - `ci.status`: `success` | `failure` | `running` | `cancelled` | `unknown`, 取最近一次 workflow run。
  - `synced`: 服务端配了 `GITHUB_TOKEN` 且至少成功回填过一次。为 false 时数据只来自 webhook, PR / Issue 列表可能不全。
- `GET /api/v1/github/repos/{owner}/{name}` (owner 或 `events:read`) -> `GithubRepoDetail`
  - `{ repo: 摘要, prs: [{ number, title, author, url, draft, updatedAt }], issues: [{ number, title, author, url, updatedAt, labels }], runs: [{ workflow, branch, status, url, at }], timeline: [{ ts, kind, title, url }] }`。
  - `timeline.kind`: `push` | `pr` | `issue` | `ci` | `release` | `star` | `comment`。runs 与 timeline 各最多 30 条, 新的在前。
  - 未登记的仓库返回 404。
- `POST /api/v1/github/sync` (owner) -> `{ ok, repos, error? }`
  - 用 `GITHUB_TOKEN` 回填: 仓库信息, 开放 PR, 开放 Issue (排除 PR), 最近 10 次 workflow run。
  - 没配 token 返回 400 `服务端没有配置 GITHUB_TOKEN` (code `not_configured`)。
  - 单次最多同步 10 个仓库 (免费计划每次调用 50 个子请求, 每个仓库 4 个)。部分失败时 `ok=false`, `error` 列出失败仓库。

## 仓库来源与更新

- 仓库 = 所有 `type=github` 数据源的 subject (`github:owner/repo` 或 `owner/repo`) + 收到过 webhook 的仓库。只有数据源没有 webhook 的仓库, 摘要全为 0。
- webhook 入库时同步更新: `ping` 登记仓库并取 stars, 描述, 默认分支, `open_issues_count` (减去已知 PR) 作为 Issue 数初值; 每个事件都会刷新 stars, 描述, 默认分支。
- `push` 更新 `lastPush` 和活跃分支列表 (只认分支, 忽略 tag 与空推送; `deleted: true` 的推送把该分支从列表拿掉), 详情带 `branches: [{ branch, at, by, commits, sha?, ci? }]`, 最近的在前, 最多 8 个, `ci` 从已存的 runs 现算; `pull_request` opened / reopened / ready_for_review / converted_to_draft / edited 写入, closed (含合并) 删除; `issues` opened / reopened / edited 写入, closed 删除, 带 `pull_request` 的忽略; `workflow_run` 按 run id 覆盖; `release` published, `star` created, `issue_comment` created 进 timeline。
- 有 `GITHUB_TOKEN` 且主人启用了插件时, Worker 的 cron 每 30 分钟自动回填一次。回填和 CF 额度检查合成同一次 RPC (`Hub.halfHourly`), 停用插件不再多花 DO 请求。

## 提交热力图 (#134)

`GET /api/v1/github/heatmap?year=2024` (owner 或 `events:read`) → `{ days: [{ date: "YYYY-MM-DD", commits }], updated, year?, years, backfill }`, 从早到晚, 日期按主人设置的时区 (设置 `tz`, 默认 Asia/Shanghai)。

- 不带 `year`: 最近 140 天。带 `year` (2008 起): 那一年 1 月 1 日到 12 月 31 日, 今年只到今天, 未来的年份为空。
- `years`: 有数据的年份 (含今年), 新的在前, 客户端据此切换年份。`backfill: { done, repos, pending, oldest? }`: 关注的仓库数, 全部历史还没拉完的仓库数, 有数据的最早一天。
- 每天的数 = max(回填的提交数, 动态累计的提交数, 最近两天的实时动态)。

数据与写入:

- 按年一行 (`githubHeat:YYYY`, `{ c: 日期 -> 回填提交数, e: 日期 -> 动态提交数 }`), 加一行状态 (`githubHeatState`: 每个仓库的游标, 有数据的年份, 最早一天, 时区)。一年 365 天也只是一行, 一次运行改到几个年份就写几行, 跟状态行一次 `put` 写完。
- 动态 (`e`): 每天 cron (`0 19 * * *`) 把留存 30 天的个人推送按天并进年份行, 同一天取较大值; 改版前的 `githubHeatmap` 行第一次刷新时并进来后删掉。
- 回填 (`c`): 对每个关注的仓库分页拉 `GET /repos/{repo}/commits?author={login}&per_page=100&until=…` (默认分支上本人的提交), 按作者时间分天求和。新仓库的窗口是 `[开始, 现在]` 的全部历史; 拉完后隔 20 小时开增量窗口 `[上次 until + 1 秒, 现在]`。游标是 (窗口, 页码), 窗口固定, 翻页不会错位。
- 分批: 每天 cron 最多 30 页; 每次同步 (cron 每 30 分钟, 或 `POST /sync`) 只用同步剩下的子请求额度, 即 min(5, 50 − 4 × min(关注仓库数, 10) − 12) 页 (关注 10 个以上仓库时同步不回填, 只靠每天 cron); 每批最多 5 个并发; 剩余额度 (`x-ratelimit-remaining`) 低于 200 或遇到 429 就停, 游标不动, 下次接着拉。404 / 409 (空仓库) / 451 / 有额度时的 403 视为看不到, 窗口直接拉完。cron 与同步在 DO 内串行, 不重复累计。
- 第一次请求时还没算过就当场算一次动态 (不调 GitHub, 只记下时区), 之后由 cron 与同步回填。
- 调用量: 一个仓库的全部历史 = ceil(本人提交数 / 100) + 1 次 (最后一页不满即拉完); 之后每个仓库每天 1 次。每天上限 30 + 48 × 5 = 270 页 (约 2.7 万个提交), 关注 10 个以上仓库时为 30 页。写入: 每次有进展的运行写 (改到的年份数 + 1) 行, 平时每天几行。
- 带 `ETag` (年份 + 日期 + 更新时间 + 最近两天提交数), 没变时 304。停用插件带 `purge=1` 时一并清掉。
- 安卓: 热力格在 GitHub 页顶部 (总览不再显示), 默认最近 140 天, 下面的年份可切到任一年, 横向滚动看全年, 底部一行显示回填进度。
- 局限: 回填只数关注仓库默认分支上 author 能对上本人账号的提交; 别的仓库与分支靠动态 (保留 30 天, 期间每天累计进 `e`)。增量窗口按提交时间过滤, 合入时保留原提交时间的旧提交会落在窗口外, 由动态补上。

## 仓库历史 (#134)

`GET /api/v1/github/repos/{owner}/{name}/history?kind=commit&before=…` (owner 或 `events:read`) → `{ repo, kind, items: [{ id, ts, kind, title, url, by?, number?, state? }], next? }`, 新的在前, 每页 30 条。

- `kind`: `commit` (默认分支的提交) | `pr` | `issue` | `release`。把 `next` 原样作为下一次的 `before`, 一直翻到没有 `next`, 即仓库全部历史。
- 游标: 提交为上一页最后一条的提交者时间 (毫秒, 下一页 `until` = 它减 1 秒); PR / Issue 用搜索 `repo:… is:pr created:<…` 按创建时间往前; 发布为页码。`state`: PR 为 `open` / `closed` / `merged`, Issue 为 `open` / `closed`。
- 不落库: 服务端代理 GitHub, 结果按 (仓库, 类别, 游标) 放 Cache API。最新一页缓存 5 分钟, 游标早于一天的历史页 7 天, 发布按页码只给 5 分钟 / 1 小时。一页一次 GitHub 调用 (PR / Issue 走搜索, 额度 30 次 / 分钟)。
- 安卓: 仓库详情 "历史" tab, 按 提交 / PR / Issue / 发布 切换, "更早的" 一直往前翻, 按 id 去重, 没有 `next` 显示已到最早一条。
- 只给关注的仓库, 否则 404; 没配 token 400 `not_configured`; GitHub 限流 429, 其他失败 502。

## 未合入分支

`GET /api/v1/github/branches?days=30&fresh=1` (events:read): 关注仓库里最近 `days` 天 (默认 30, 最多 90) 有提交, 还没合入默认分支的分支。

- 判定: 分支有自己的提交 (`ahead > 0`), 没被删, 最近关联的 PR 没有合入 (squash 合入也算已合)。
- `behind`: 落后默认分支的提交数, 越大越难合。`pr`: 开着的 PR。`ci`: 该分支最近一次 CI (来自已存的 runs)。
- 需要 `GITHUB_TOKEN`。服务端每 5 个仓库合成一次 GraphQL, 最多 40 个仓库; 结果缓存 10 分钟, `fresh=1` 跳过缓存。单个仓库出错写在它自己的 `error` 里。
- 安卓: GitHub 页 "未合入分支" 卡 (全局, 新鲜度条 + 每仓库 3 条), 仓库详情 "未合入" tab。
