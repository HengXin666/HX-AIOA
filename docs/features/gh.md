# GitHub 授权插件与待办关联

云端 Agent 是无状态的, 没有主人的 GitHub 账号。`hengxin666.gh` (旧 id `gh`, 路径里照常能用) 是插件体系 v2 (#99) 里的无 Agent 内置插件 (不建群, 不带 Agent, 只启用不安装): 管理员放行, 主人启用后授权一次, 令牌加密存在服务端, 其他插件的 Agent 通过服务端代办 issue 操作, 永远拿不到令牌。

## 启用与停用

- 主人没启用时 `/api/v1/gh/*` 一律 404, 待办的 issue 同步 (定时, webhook, 打开待办时) 也不跑, 专属指令里没有 issue 一节; 判断只查 Hub 内存, 不查库。
- `PUT /api/v1/plugins/hengxin666.gh/enabled` 启用; `DELETE .../enabled` 停用, 令牌与规则保留; 带 `?purge=1` 清掉令牌, 仓库规则, Agent 开关与操作记录。
- 升级迁移: 升级前装过旧 base 插件 `gh` 的部署, 第一次唤醒时自动放行并为主人启用, 删掉旧安装记录, 令牌与规则原样保留; 只做一次, 之后停用或撤销不会被改回。没装过的等管理员放行。

## 授权

| 方式 | 说明 |
| --- | --- |
| 设备码 (推荐) | `POST /api/v1/gh/device` 返回 `userCode` 与 `verifyUrl`, 主人在任何登录了 GitHub 的设备 (通常是电脑) 上输入; App 每 `interval` 秒 `POST /api/v1/gh/device/{id}` 轮询, `status` 为 `done` 即完成。需要服务端变量 `GH_CLIENT_ID` (OAuth App 或开了 Device Flow 的 GitHub App): 在仓库 Settings → Secrets and variables → Actions → Variables 填 `AIOA_GH_CLIENT_ID`, 部署时同步为 Worker 的 secret。Fork 请用自己的 OAuth App。 |
| 粘贴令牌 | `PUT /api/v1/gh/token { "token": "github_pat_..." }`, 建议 fine-grained, 只给 Issues 读写。 |

- 令牌用 AES-GCM 加密落库 (密钥由 `TOKEN_SECRET` 派生); `DELETE /api/v1/gh/token` 或停用并清除 (`?purge=1`) 即删除。
- 会过期的令牌 (GitHub App, 或 OAuth App 开了 "用户令牌过期", 设备码拿到的令牌 8 小时过期) 配了 `GH_CLIENT_SECRET` (仓库 Actions Secrets 填 `AIOA_GH_CLIENT_SECRET`, 部署时同步) 时在剩 5 分钟或 GitHub 回 401 时用 refresh token 自动续期 (同一时刻只续一次)。没配就不续 (实测不带 secret 续出的令牌调接口 401, 还会作废旧令牌), 令牌照用到 GitHub 真的拒绝为止。不过期的令牌 (GitHub 没返回 `expires_in`) 直接长期使用。
- 不能续期时 `GET` 返回的 `auth.renewable` 为 false, App 标红; 过了到期时间 cron 探一次, GitHub 真拒绝了才给主人发一条系统消息, 每个到期时间只发一次。

## 仓库范围

GitHub 上授权的仓库是上限, `PUT /api/v1/gh/rules` 再收窄 (`GhRules`):

| 字段 | 含义 |
| --- | --- |
| `pushedDays` | 最近 N 天有推送的 (近一年 = 365) |
| `public` / `private` | 全部公开 / 全部私有 |
| `repos` / `deny` | 手动放行 / 排除, 优先级 deny > repos > 规则 |

`GET /api/v1/gh/repos` 列出令牌能看到的仓库及是否放行 (10 分钟缓存, `fresh=1` 刷新)。

## Agent 权限与 issue 代理

- 插件清单在 `requires` / `optional` 里声明了 `service:gh.issues` (旧清单的 `deps` 写了 `gh` 也算) 的插件, 其 Agent 默认可用; 其他 Agent 默认不可用。`PUT /api/v1/gh/agents/{keyId} { "allowed": bool }` 单独开关。子号与外部接入密钥一律不可用。
- 接口 (主人或获准的 Agent): `GET|POST /api/v1/gh/issues/{owner}/{name}` (列出 / 新建, 新建可带 `parent` 挂到父 issue, 带 `todo: { channel, id }` 顺手关联待办), `GET|PATCH .../{number}`, `POST .../{number}/comments`, `POST .../{number}/sub`。
- 每次操作记一笔 (`GET /api/v1/gh` 的 `ops`, 最近 50 条)。没授权 409, 仓库没放行或没权限 403, 错误里写明怎么放行。

## 待办与 issue 同步

待办写了 `repo` + `issue` 就算关联。服务端按 GitHub 状态改待办:

| GitHub | 待办 |
| --- | --- |
| issue 关闭 | 已完成, 群里发一条不响铃的系统消息 |
| 打开且有评论 | 待进行 -> 进行中 |
| 重新打开 | 已完成 -> 待进行 (有评论则进行中) |

挂起只由人或 Agent 改, 同步不动。触发: GitHub webhook 的 `issues` / `issue_comment` 事件 (只同步那一条), 打开待办 (最多 5 分钟一次), 每 30 分钟定时, 以及 `POST /chats/{channel}/todos-sync`。查询走 GraphQL 批量 (每次 40 条), 同时取父 issue 号与子 issue 数, 供 App 画树。

## 外部接入

待办插件可以给别的 AI (Hark, Claude, Cursor 等) 发接入密钥: 只能碰这一个群的待办, 默认 24 小时过期, 可只读或可写, 随时吊销。

- MCP: `POST /api/v1/ext/mcp`, `Authorization: Bearer <密钥>`。
- 不支持 MCP 的: `GET /api/v1/ext/todos.md?key=<密钥>` 返回按日期和仓库分组的 Markdown。

## App

- 插件市场 → GitHub 授权: 授权 (获取授权码在电脑上输入, 或粘贴令牌), 仓库快捷规则与逐个开关, Agent 开关, 最近操作。
- 插件市场 → 点子待办: 依赖状态, 外部接入 (新建密钥只显示一次, 可复制 MCP 配置或 Markdown 链接; 已发出的可吊销)。
- 待办群顶上切换 聊天 / 待办。待办页: 按日期 (天 > 仓库) 与按仓库 (仓库 > 天) 一键互换, 父任务可折叠并显示子任务进度, 已完成默认隐藏 (打开后划掉显示), 仓库多选 / 只看有 issue / 优先级筛选并记住; 点一条打开详情切换四态与优先级, 跳回来源消息, 内置浏览器打开 issue; 下拉立即同步 GitHub。代码在 `ui/todo/`。
