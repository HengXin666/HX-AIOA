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
  - 摘要: `{ repo, url, description?, stars, openPrs, openIssues, defaultBranch?, lastPush?: { at, by, branch, commits, sha? }, ci?: { status, workflow, branch, url, at }, fork?, parent?, updatedAt }`。
  - `fork` / `parent` (#144): fork 来的仓库为 `true` 与上游 `owner/repo`, 自建的不带。同步时按 `GET /repos/{repo}` 的 `fork` 与 `parent.full_name` 覆盖 (不多花子请求); webhook 只带 `repository.fork` 布尔值, 只改标识不动上游。
  - `ci.status`: `success` | `failure` | `running` | `cancelled` | `unknown`, 取最近一次 workflow run。
  - `synced`: 服务端配了 `GITHUB_TOKEN` 且至少成功回填过一次。为 false 时数据只来自 webhook, PR / Issue 列表可能不全。
- `GET /api/v1/github/repos/{owner}/{name}` (owner 或 `events:read`) -> `GithubRepoDetail`
  - `{ repo: 摘要, prs: [{ number, title, author, url, draft, updatedAt }], issues: [{ number, title, author, url, updatedAt, labels }], runs: [{ workflow, branch, status, url, at }], timeline: [{ ts, kind, title, url }] }`。
  - `timeline.kind`: `push` | `pr` | `issue` | `ci` | `release` | `star` | `comment`。runs 与 timeline 各最多 30 条, 新的在前。
  - 未登记的仓库返回 404。
- `POST /api/v1/github/sync` (owner) -> `{ ok, repos, error? }`
  - 用 `GITHUB_TOKEN` 回填: 仓库信息 (含 fork 与上游), 开放 PR, 开放 Issue (排除 PR), 最近 10 次 workflow run。
  - 没配 token 返回 400 `服务端没有配置 GITHUB_TOKEN` (code `not_configured`)。
  - 单次最多同步 10 个仓库 (免费计划每次调用 50 个子请求, 每个仓库 4 个)。部分失败时 `ok=false`, `error` 列出失败仓库。

## 仓库来源与更新

- 仓库 = 所有 `type=github` 数据源的 subject (`github:owner/repo` 或 `owner/repo`) + 收到过 webhook 的仓库。只有数据源没有 webhook 的仓库, 摘要全为 0。
- webhook 入库时同步更新: `ping` 登记仓库并取 stars, 描述, 默认分支, `open_issues_count` (减去已知 PR) 作为 Issue 数初值; 每个事件都会刷新 stars, 描述, 默认分支。
- `push` 更新 `lastPush` 和活跃分支列表 (只认分支, 忽略 tag 与空推送; `deleted: true` 的推送把该分支从列表拿掉), 详情带 `branches: [{ branch, at, by, commits, sha?, ci? }]`, 最近的在前, 最多 8 个, `ci` 从已存的 runs 现算; `pull_request` opened / reopened / ready_for_review / converted_to_draft / edited 写入, closed (含合并) 删除; `issues` opened / reopened / edited 写入, closed 删除, 带 `pull_request` 的忽略; `workflow_run` 按 run id 覆盖; `release` published, `star` created, `issue_comment` created 进 timeline。
- 有 `GITHUB_TOKEN` 且主人启用了插件时, Worker 的 cron 每 30 分钟自动回填一次。回填和 CF 额度检查合成同一次 RPC (`Hub.halfHourly`), 停用插件不再多花 DO 请求。

## 提交热力图 (#134)

`GET /api/v1/github/heatmap?year=2024` (owner 或 `events:read`) → `{ days: [{ date: "YYYY-MM-DD", commits }], updated, year?, years, backfill }`, 从早到晚, 日期按主人设置的时区 (设置 `tz`, 默认 Asia/Shanghai)。

- 不带 `year`: 最近 140 天, 再往前补到第一天所在那周的周一 (#144), 共 140 到 146 天, 第一天总是周一。安卓按周一对齐成列, 不补时第一列前几格画成空白, 其实那几天有提交。ETag 带 `w` 前缀, 旧缓存随之失效。带 `year` (2008 起): 那一年 1 月 1 日到 12 月 31 日, 今年只到今天, 未来的年份为空。
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

## 走势与足迹 (#142)

`GET /api/v1/github/trend?tz=Asia/Shanghai&repo=owner/name` (owner 或 `events:read`) → `GithubTrendResult`, GitHub 页的全部折线 / 混合图与足迹一次给全, 带 `ETag` (仓库 + 时区 + 今天 + 同步时间), 没变时 304。只读库, 不调 GitHub。

- `repo` (可选, #144): 只算这个仓库的行 (我的提交, 我开的 Issue / PR, 我的评论与评审), `created` / `starred` 为空, 给单仓库页的混合图; 格式不对 400。

```
{ login, syncedAt?, backfill: { done },
  days:  { points: GithubTrendPoint[14], received },   // 按天, 最近 14 天, 从早到晚
  weeks: { points: GithubTrendPoint[12], received },   // 按周 (周一起), 最近 12 周, 本周只算到今天
  created: [{ repo, url, at, description?, private?, fork?, parent? }], // 账号下最新创建的仓库, 新的在前, 最多 20
  starred: [{ repo, url, at, description?, stars }] }   // 我 star 的仓库, 按 star 时间, 最多 20
GithubTrendPoint = { label: "YYYY-MM-DD" (那一格第一天), commits, prOpened, prMerged, prClosed, issueOpened, issueClosed, prComments, issueComments, reviews }
```

- `tz`: IANA 时区名, 按它分天; 不传或不认识时用主人设置的时区。提交数例外: 用 GitHub 贡献日历的日期 (提交者本地日期), 与热力格一致。
- `prOpened` / `issueOpened`: 我开的; `prMerged`: 我开的 PR 被合入 (按合入时间); `prClosed`: 没合入就关了; `issueClosed`: 我开的 Issue 被关 (按关闭时间, 很早开的 Issue 最近才关也算在关的那天)。
- `issueClosed` / `issueDropped` (#145): Issue 关闭完成 (含没写原因的) / 未完成就关 (`stateReason` 为 NOT_PLANNED 或 DUPLICATE); `/github/daily` 的 `issueClosed` 仍是两者之和。
- `prComments` / `issueComments`: 我在 PR / Issue 下发的评论; `received`: 范围内我新开的 Issue / PR 当前收到的评论总数; `reviews`: 我提交的 PR 评审。
- `backfill.done`: Issue / PR 与评论都已补到 12 周前; 为 false 时较早的格子可能偏少。

同步 (每 30 分钟 cron 与 `POST /sync` 顺带, 需要 `GITHUB_TOKEN`):

- 一次 GraphQL 拿全: `viewer.contributionsCollection` (近 105 天, `commitContributionsByRepository` 每仓库最近 100 个有提交的日子, `pullRequestReviewContributions`), `viewer.repositories(ownerAffiliations: OWNER, orderBy: CREATED_AT DESC)` 最新 20 个 (带 `isFork` 与 `parent`), `starredRepositories` (按 star 时间最近 50), `issueComments` (最近 100), `viewer.issues` / `viewer.pullRequests` (按更新时间最近 50, 新开 / 关闭 / 合入都会出现在这里)。GraphQL 计费约 1 点。
- 为什么不用搜索 (#145): 服务端是 fine-grained 令牌, 同一轮里依赖 viewer 的提交与评论都有数据, 但 `search(author:<login>)` 一直拿不到我开的 Issue / PR (本机经典令牌同一查询有 400 多条), 线上 PR / Issue 全为 0。改成只用 viewer 自己的列表与贡献集合, 不依赖令牌类型。
- 补历史: 我开的 Issue / PR 用贡献集合 `issueContributions` / `pullRequestContributions(first: 100, after: …)` 按开的时间往前翻, 评论用 `issueComments(last: 100, before: …)` 往前翻, 都到 98 天前或到底为止, 只补一次。每次同步除第一页外用剩余子请求额度最多再翻 3 页 (只带更早的评论与贡献), 一般一两轮 cron 补完。旧状态 (搜索游标) 升级后会从最新一页重新补。
- 新建仓库为什么不用 `repositoryContributions` (#144): 它不含私有仓库 (算受限贡献), 足迹跟 GitHub 仓库列表对不上; 改用仓库列表后私有与 fork 都在, 每次整份替换, 删掉的仓库也跟着消失。fork 在安卓上标 "fork" 并显示上游, 自建的标 "自建"。
- 存储: 表 `gh_trend (k 主键, kind, ts, body)`, 一件事一行 (Issue / PR / 评论按节点 id, 提交按 仓库 + 日期, 评审按 URL, 新建仓库与 star 按仓库名), 内容没变不写。`ts` 为最后一次动静 (Issue / PR 取 开 / 关 / 合入 的最晚者); 超过 105 天的行删掉, 新建仓库与 star 每次整份替换 (取消 star 即消失)。回补游标存 `githubTrend` (KV)。停用插件带 `purge=1` 时一并清掉。
- 为什么不用事件 API: `/users/{login}/events` 只给最近 300 条 / 90 天, 原实现只拉第 1 页 (100 条), 一天就有上百条 (评论, 加标签) 时只能盖住一两天, 更早的永远拉不到; 推送事件也不再带提交数。`GET /github/daily` (总览, 周报用) 在走势同步过一次后, 提交 / PR / Issue / 评审 / 评论也改从 `gh_trend` 算, 只有推送次数仍来自事件。
- 安卓走势合一图 (#145): GitHub 页 "走势" 卡与单仓库页 (带 `repo` 请求) 共用一张双轴图: 提交 = 面积, 用右轴 (刻度同色); PR 新开 = 实线, PR 合入 = 柱, PR 未合入关闭 = 点, Issue 新开 = 虚线, Issue 关闭完成 = 柱, Issue 未完成关闭 = 点, 评论 = 实线, 共用左轴。图例点一下显示 / 隐藏该系列; "拆分" 切回每类一张小图 (提交, PR, Issue, 评论), 各用自己的轴。点或横向拖动选中一格: 竖线标出, 提示框列出每个系列这一格的数 (双轴时注明左轴 / 右轴), 拆分时所有小图选中同一格; 再点同一格收起。横向拖过手势阈值才接管, 纵向滑动仍滚动页面。
- 安卓卡片折叠 (#144): GitHub 页与单仓库页每张卡点卡片头收起 / 展开, 折起的卡片记在本机 (`github_fold`), 单仓库页的卡片所有仓库共用一份。仓库列表与足迹的新建仓库标 fork (写上游) 或自建。
- 安卓: GitHub 页 "走势" 卡 (热力格下面), 14 天 / 12 周切换只换本地数据, 图见上一条; 下面是 "足迹" (新建仓库 / star 列表, 带时间)。热力格按年看时, 首列不足一周的补位格 (上一年的几天) 不画 (#145)。

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
