# GitHub 页面接口 (v1)

服务端与安卓共用的约定, 类型见 `protocol/src/v1/github.ts`, 路径常量 `PATH_GITHUB_REPOS`, `PATH_GITHUB_REPO`, `PATH_GITHUB_SYNC`。时间字段都是毫秒时间戳。

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
- 有 `GITHUB_TOKEN` 时 Worker 的 cron 每 30 分钟自动回填一次。

## 未合入分支

`GET /api/v1/github/branches?days=30&fresh=1` (events:read): 关注仓库里最近 `days` 天 (默认 30, 最多 90) 有提交, 还没合入默认分支的分支。

- 判定: 分支有自己的提交 (`ahead > 0`), 没被删, 最近关联的 PR 没有合入 (squash 合入也算已合)。
- `behind`: 落后默认分支的提交数, 越大越难合。`pr`: 开着的 PR。`ci`: 该分支最近一次 CI (来自已存的 runs)。
- 需要 `GITHUB_TOKEN`。服务端每 5 个仓库合成一次 GraphQL, 最多 40 个仓库; 结果缓存 10 分钟, `fresh=1` 跳过缓存。单个仓库出错写在它自己的 `error` 里。
- 安卓: GitHub 页 "未合入分支" 卡 (全局, 新鲜度条 + 每仓库 3 条), 仓库详情 "未合入" tab。
