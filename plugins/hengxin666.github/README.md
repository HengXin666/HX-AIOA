# GitHub 接入

服务端内置插件 (L2a): 代码随部署发布, 由管理员放行, 账号自己启用。不需要安装, 也没有 Agent。

## 能做什么

- 关注仓库的摘要: stars, 开放 PR / Issue, 最近推送, 最新 CI。
- 仓库详情: PR, Issue, workflow run, 时间线, 活跃分支。
- 本人动态, 每日柱状图, 未合入分支。
- 云 Agent 用带 `events:read` 的 key 读上面这些接口。

## 数据从哪来

- 服务端配了 `GITHUB_TOKEN` 时, cron 每 30 分钟回填一次 (每次最多 10 个仓库)。
- 仓库里配了 webhook 时实时入库 (`/api/v1/hooks/github/{keyId}`)。

## 启用与停用

- 主人停用后: `/api/v1/github/*` 全部 404 (云 Agent 的 key 也是), webhook 不入库 (404), cron 跳过回填。
- 停用时带 `?purge=1` 会清空仓库, PR, Issue, CI, 时间线, 动态等全部 GitHub 数据; 不带则保留, 再启用即恢复。
- GitHub 那边的 webhook 仍会发过来, 只是返回 404; 要彻底不发, 在仓库设置里删掉 webhook。

接口见 `docs/api/github.md`。
