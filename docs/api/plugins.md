# 插件接口: 白名单, 账号启用, 插件数据

设计与取舍见 `docs/design/plugin-arch.md`, 清单格式见 `plugins/README.md`。类型真源: `protocol/src/v1/plugin-api.ts`, `plugin-v2.ts`, `plugin-check.ts`。

## 三层

1. 白名单 (全局): 管理员 (主人, 或角色为 admin 的账号) 放行。每个插件只有一个版本, 放行时把清单和提示词模板存成快照, 之后安装与更新只用快照, 市场出新版不会自动生效。
2. 账号启用: 每个账号从白名单里自己开关, 状态在 Hub 内存 Set 里, 判断不查库, 不多一次 DO 请求。
3. 数据: `pdata` 按 (账号, 插件) 隔离。

## 白名单

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/plugin-allow` | 主人与子号都能看: `{ allow, enabled, choices, budget: { total, limit }, admin }`, `enabled` 与 `choices` 是调用者账号的 |
| PUT | `/api/v1/plugin-allow/{id}` | 管理员: 放行市场当前版本, 已放行的即换版本。体 `{ "version"?: "1.2.0", "defaults"?: ["core.theme.base"] }` |
| DELETE | `/api/v1/plugin-allow/{id}` | 管理员: 撤销。所有账号一起停用, 主人已装的 Agent 与工作台一并拆掉, 数据保留 |

放行前把新清单放进当前白名单整体做静态检查 (`checkPlugins`), 有冲突返回 409 `plugin_conflict` 与 `conflicts` (`kind`: engine, requires, duplicate, single, order, conflicts, budget), 不写入。

- `single`: 单选扩展点或服务有多个提供者, 放行时用 `defaults` 指定默认即可通过; 默认只能有一个, 给新插件时旧的自动去掉。
- `budget`: 白名单全部插件估算每天请求超过 5 万 (免费额度一半)。估算 = cron 每天次数 + Agent 定时拉取 (86400 / 秒) + 自报的 `requestsPerDay`。
- 高危权限 (`ui.webview`, `core.replace`, `net:*`) 放行后在 `allow[].risky` 里列出, 客户端单独提示。

## 账号启用

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| PUT | `/api/v1/plugins/{id}/enabled` | 本账号启用 (必须已放行) |
| DELETE | `/api/v1/plugins/{id}/enabled` | 本账号停用; `?purge=1` 同时清掉本账号在该插件下的全部数据, 返回 `purged` 行数。主人停用时一并拆掉 Agent 与工作台 |
| PUT | `/api/v1/plugin-choice/{point}` | 本账号在单选扩展点或服务 (`service:x`) 上改选 `{ "plugin": "a.b" }`, `null` 回到管理员默认 |

主人的 `POST /api/v1/plugins/{id}/install` 等于 "启用 + 建群 + 发 Agent 密钥 + 下发工作台", 卸载等于反过来; 都只用白名单快照。子号目前只能启用 (用扩展点与数据), 群和 Agent 仍归主人。

升级前装好的插件在白名单为空时自动放进白名单并为主人启用, 只做一次。

没有 Agent 的插件 (api 2 的清单可以不写 `agent`) 不能安装 (`install` 返回 400), 只启用。

## 内置插件 (L2a)

代码随部署发布, 清单也打进部署 (`plugins/<id>/plugin.json`), 门控同样只查内核内存。

| 插件 | 门控 | 数据 |
| --- | --- | --- |
| `hengxin666.github` (GitHub 接入) | 主人没启用时: `/api/v1/github/*` 404 (云 Agent 的 key 也是), `POST /api/v1/hooks/github/...` 404 不入库, cron 不回填 | 现有 `gh_*` 表, 不进 pdata; 主人停用带 `?purge=1` 时清空 |

- 升级迁移: 每个内置插件第一次唤醒时若不在白名单, 用打包的清单放进白名单并为主人启用 (`by: "升级迁移"`), 只做一次, 之后撤销或停用都不会被改回。
- GitHub 数据属于整个部署 (一个 `GITHUB_TOKEN`), 所以只看主人的启用状态; 子号启用它没有作用。

## 插件数据 pdata

集合必须在清单 `contributes.collections` 里声明, 插件要有 `data:own` 权限。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/pdata/{plugin}/{coll}?since=0&limit=200` | 增量: `{ items, rev, more }`, 按 `rev` 升序, 含墓碑 (`deleted: true`) |
| GET | `/api/v1/pdata/{plugin}/{coll}/{id}` | 单行 |
| PUT | `/api/v1/pdata/{plugin}/{coll}/{id}` | `{ "ver": 读到的版本 (新建为 0), "body": {...} }`; 版本不对返回 409 与 `current` |
| DELETE | `/api/v1/pdata/{plugin}/{coll}/{id}?ver=3` | 写墓碑 |
| POST | `/api/v1/pdata/{plugin}/{coll}` | 批量写 `{ "items": [{ "id", "ver", "body" }, { "id", "ver", "deleted": true }] }`, 一次最多 50 行, 每行独立生效; 返回 `{ items: [{ id, item? , conflict?, error? }], rev }`, 只推一次 `pdata_sync`。Agent 一轮整理多条只用一次请求 |

- 谁能用: 主人与子号用自己账号下启用了的插件; 插件 Agent 的密钥落在主人账号, 能读写本插件的集合, 读别的插件要清单里有 `data:read:<插件>.<集合>`, 不能写别人的。
- 校验: 声明了 `fields` 的集合只收声明过的字段且类型要对; 每行 16000 字以内; 每个 (账号, 插件) 最多 2000 行。
- 内容没变不写库也不推送; 新建一行约 3 行写入 (数据行, 主键, rev 索引), 改一行约 2 行, 计入每天 10 万行写入额度。rev 取 (账号, 插件) 当前最大 rev 加 1, 只在清除数据时把下限记进 `pdata_seq`。
- 写入后推 `pdata_sync` 给该账号的界面连接 (见 `stream.md`)。

## 待办插件 (#101)

- id `hengxin666.todo` (旧 id `todo` 在 `/plugins/{id}`, `/plugins/{id}/enabled`, `/plugin-allow/{id}` 路径里作别名); 群与工作台沿用 `plugin-todo`。
- 数据: 主人账号下集合 `items`, 一行一条, id = `<群>:<待办 id>`, body `{ channel, title, note?, state, prio, src?, created }`, 更新时间用行的 `updated`。除了集合声明的类型, 服务端还校验 state / prio 取值与 id 前缀 (`checkTodoBody`)。
- 升级: Hub 唤醒时一次性把旧 `todo` 表搬进 pdata, 并把白名单, 启用, 单选, 安装记录, 群里 Agent 的 `plugin` 字段中的 `todo` 改成新 id; 白名单快照补上 v2 数据声明, 版本号不变, 管理员放行 2.0.0 后整份换掉。Agent 密钥照用, 专属指令的待办说明换成 pdata 接口 (版本变化会提示 Agent 重拉)。
- 旧接口 `/api/v1/chats/{channel}/todos` 转发到 pdata (主人账号), 保留一个大版本后删除; 启用判断看调用者自己的账号 (子号要自己启用), 普通 Agent 的 key 算主人账号。写入同时推 `pdata_sync` 与旧客户端认的 `chat_sync` (`topic: todos`); 经 pdata 改主人的待办也会推 `chat_sync`。
- 回滚: 迁移不可逆 (旧表已删), 回滚旧版服务端会看到空的待办表; 需要回滚时先用 `GET /api/v1/pdata/hengxin666.todo/items` 导出。

## 事件与扩展点

扩展点目录与基数在 `EXT_POINTS` (commands, widgets, settings, collections, push.route, message.beforeSend, core.theme.base, core.chat.renderer, core.push.transport)。内核 `PluginKernel` 按账号给出生效的贡献: single 按 "账号选择 > 管理员默认 > 唯一启用者" 裁决, pipeline 按 before / after 拓扑排序。

事件总线只在 Hub 内存分发, 至多一次, 不落库; 发送方必须在 `emits` 声明, 接收方必须在 `listens` 声明, 只送给该账号启用了的插件。要可靠就写 pdata。

## 验证

- 单元: `npm test` (清单, 冲突检测, 内核, pdata)。
- 端到端: 本机 `wrangler dev --var PLUGIN_MARKET:http://127.0.0.1:8797` 后跑 `tools/e2e-plugins.mjs` (官方市场的待办插件) 与 `tools/e2e-plugin-kernel.mjs` (`tools/fixtures/plugin-market` 里的测试插件)。待办迁移: 同一个 `--persist-to` 目录先用旧版服务端跑 `AIOA_PHASE=seed tools/e2e-todo-migrate.mjs` (`AIOA_MARKET_ROOT` 指旧版的 `plugins/`), 再换新版跑 `AIOA_PHASE=check` (重启后再跑一次验证幂等)。 GitHub 插件: `tools/e2e-github-plugin.mjs` (放行, 启用, 停用 404, 再启用数据还在, purge)。
- 市场 CI: `npm run check:plugins` (`.github/workflows/plugins.yml`)。
