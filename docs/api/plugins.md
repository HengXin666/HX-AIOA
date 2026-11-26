# 插件接口: 白名单, 账号启用, 插件数据

设计与取舍见 `docs/design/plugin-arch.md`, 清单格式见 `plugins/README.md`。类型真源: `protocol/src/v1/plugin-api.ts`, `plugin-v2.ts`, `plugin-check.ts`。

## 三层

1. 白名单 (全局): 管理员 (主人, 或角色为 admin 的账号) 放行。每个插件只有一个版本, 放行时把清单和提示词模板存成快照, 之后安装与更新只用快照, 市场出新版不会自动生效。
2. 账号启用: 每个账号从白名单里自己开关, 状态在 Hub 内存 Set 里, 判断不查库, 不多一次 DO 请求。
3. 数据: `pdata` 按 (账号, 插件) 隔离。

## 市场与安装

插件市场是仓库 `plugins/` 目录 (格式见 `plugins/README.md`), 服务端按需拉取并在内存缓存 5 分钟 (打开详情和更新时绕过缓存); 本地测试用 `--var PLUGIN_MARKET:<地址>` 指向别处。

安装时提示词模板存进库里, 之后专属指令都用这份。自动更新 (缺省开) 在三个时机检查版本: 打开市场列表, 打开插件详情, 插件 Agent 拉专属指令; 版本不同就换模板和工作台。专属指令随之变版本号, Agent 按版本号自己换新。市场连不上时保持旧版。

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/v1/plugins` | 主人, 子号 | 市场列表 + 放行 / 启用状态 + `admin`, 安装记录只给主人; 开发插件 (`dev: true`) 排在前面, 只有开发者自己看得到; 市场连不上时只返回已安装的, 带 `error` |
| GET | `/api/v1/plugins/{id}` | 主人, 子号 | 清单 (开发插件用它的快照), 介绍原文 (`readmeType`: markdown / html), 安装状态, `task` 任务提示词 (已代入群与地址, 不含密钥; 未安装时按默认群预览) |
| POST | `/api/v1/plugins/{id}/install` | 主人 | 建群 `plugin-<id>`, 接入 Agent (专属指令带插件提示词), 下发工作台; 只给一次: `prompt` 一段接入语 (文档链接, 定时, 任务, 密钥), `key` 密钥另给一份 |
| POST | `/api/v1/plugins/{id}/update` | 主人 | 手动更新到市场最新版 (绕过缓存, 版本相同也重拉), 群, Agent, 密钥, 待办不变; 返回 `{ install }` |
| PATCH | `/api/v1/plugins/{id}` | 主人 | `{ "auto": bool }` 自动更新开关, 缺省开 |
| DELETE | `/api/v1/plugins/{id}` | 主人 | 作废 Agent, 移除工作台; 群消息与待办保留 |

安装 (建群, Agent, 工作台) 只有主人能做, 群与 Agent 归主人; 子号与 admin 子号在市场里看, 自己启用 (见下), 管理员还能放行与撤销。

## 白名单

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/plugin-allow` | 主人与子号都能看: `{ allow, enabled, choices, budget: { total, limit }, admin }`, `enabled` 与 `choices` 是调用者账号的 |
| PUT | `/api/v1/plugin-allow/{id}` | 管理员: 放行市场当前版本, 已放行的即换版本。体 `{ "version"?: "1.2.0", "defaults"?: ["core.theme.base"] }` |
| DELETE | `/api/v1/plugin-allow/{id}` | 管理员: 撤销。所有账号一起停用, 主人已装的 Agent 与工作台一并拆掉, 数据保留 |

放行前把新清单放进当前白名单整体做静态检查 (`checkPlugins`), 有冲突返回 409 `plugin_conflict` 与 `conflicts` (`kind`: engine, requires, duplicate, single, order, conflicts, budget), 不写入。

- `single`: 单选扩展点或服务有多个提供者, 放行时用 `defaults` 指定默认即可通过; 默认只能有一个, 给新插件时旧的自动去掉。
- `budget`: 白名单全部插件估算每天请求超过 5 万 (免费额度一半)。估算 = cron 每天次数 + Agent 定时拉取 (86400 / 秒) + 自报的 `requestsPerDay`。
- 高危权限 (`ui.webview`, `core.replace`, `net:*`, `data:read:*`) 放行后在 `allow[].risky` 里列出, 客户端在放行与启用前单独确认。
- 清单写 `"server": true` (带服务端代码) 但这次部署里没有 (不在 `L2A_PLUGINS`) 的, 放行返回 409 `plugin_needs_deploy`: 代码要先走 PR 合进仓库并部署。
- `GET` 还给出 `server` (这次部署编进去的服务端插件) 与 `dev` (本账号开没开开发模式)。

## 账号启用

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| PUT | `/api/v1/plugins/{id}/enabled` | 本账号启用 (必须已放行; 别人的开发插件当没放行)。数据属于整个部署的服务端插件 (GitHub 接入, GitHub 授权, hxoa 接入) 只看主人的启用, 子号启用返回 400 |
| DELETE | `/api/v1/plugins/{id}/enabled` | 本账号停用; `?purge=1` 同时清掉本账号在该插件下的全部数据, 返回 `purged` 行数。主人停用时一并拆掉 Agent 与工作台 |
| PUT | `/api/v1/plugin-choice/{point}` | 本账号在单选扩展点或服务 (`service:x`) 上改选 `{ "plugin": "a.b" }`, `null` 回到管理员默认 |

主人的 `POST /api/v1/plugins/{id}/install` 等于 "启用 + 建群 + 发 Agent 密钥 + 下发工作台", 卸载等于反过来; 都只用白名单快照。子号只启用 (用扩展点与自己的数据), 群和 Agent 仍归主人。

升级前装好的插件在白名单为空时自动放进白名单并为主人启用, 只做一次。

没有 Agent 的插件 (api 2 的清单可以不写 `agent`) 不能安装 (`install` 返回 400), 只启用。

## 服务端插件 (L2a)

代码随部署发布: 清单写 `"server": true`, id 登记在 `protocol/src/v1/plugin-l2a.ts` 的 `L2A_PLUGINS`, 服务端在 `server/src/plugins/l2a.ts` 登记归属 (`owner`: 数据属于整个部署, 只看主人的启用) 与停用清除。市场 CI 校验两边一致。白名单只能放行这次部署里有的; 新的服务端插件走 "PR 合进仓库 → 部署 → 管理员放行", 白名单变化本身不触发部署, 账号开关也不部署。`net:*` 权限只给服务端插件。门控只查内核内存。

| 插件 | 门控 | 数据 |
| --- | --- | --- |
| `hengxin666.github` (GitHub 接入) | 主人没启用时: `/api/v1/github/*` 404 (云 Agent 的 key 也是), `POST /api/v1/hooks/github/...` 404 不入库, cron 不回填 | 现有 `gh_*` 表, 不进 pdata; 主人停用带 `?purge=1` 时清空 |
| `hengxin666.hxoa` (hxoa 接入) | 主人没启用时: `/api/v1/hxoa/*` 404 | `hxoa` 表 (接入与令牌); 主人停用带 `?purge=1` 时清空 |
| `hengxin666.todo` (待办) | 按调用者自己的账号 (个人归属), 见下文 | pdata |
| `hengxin666.gh` (GitHub 授权, 旧 id `gh`) | 主人没启用时: `/api/v1/gh/*` 404, 待办 issue 同步不跑, 专属指令不带 issue 一节; 提供 `service:gh.issues`, 声明了它的插件 (待办) 的 Agent 默认可用 | `gh` 表 (加密令牌, 规则, Agent 开关, 操作记录); 主人停用带 `?purge=1` 时清空 |

- 升级迁移: 每个内置插件第一次唤醒时若不在白名单, 用打包的清单放进白名单并为主人启用 (`by: "升级迁移"`), 只做一次, 之后撤销或停用都不会被改回。GitHub 授权只在升级前装过旧 base 插件 `gh` 时迁移, 并删掉旧安装记录。
- cron 每 30 分钟一次 RPC (`Hub.halfHourly`, `server/src/cron.ts`) 做完 CF 额度检查, 待办 issue 同步, GitHub 回填, 各项按配置与启用状态跳过。
- GitHub 数据属于整个部署 (一个 `GITHUB_TOKEN`), 所以只看主人的启用状态; 子号启用它没有作用。

## 开发模式

管理员 (主人或 admin 子号) 在自己账号上试本地插件, 不进市场, 别人看不到也用不了; 只允许 L0 (提示词, 布局, 主题) / L1 / L3 (Agent), 不能带服务端代码 (`server`, `net:*`), 不能占用已放行或登记为服务端插件的 id。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/plugin-dev` | `{ on, plugins }`: 开关与本账号的开发插件 |
| PUT | `/api/v1/plugin-dev` | `{ "on": true \| false }`; 关掉时本账号的开发插件全部撤掉 (主人装的 Agent 与工作台一起拆, pdata 保留) |
| PUT | `/api/v1/plugin-dev/{id}` | `{ "manifest": {...}, "prompt"?: "...", "readme"?: "..." }` 装上或换版本 (要先开开发模式); 对白名单做冲突检测, 自动为本账号启用; 主人装过它的 Agent 时立即换上新提示词并推给 Agent 长连 (秒级生效) |
| DELETE | `/api/v1/plugin-dev/{id}` | 撤掉 |

开发插件在白名单里带 `dev: true`, `by` 是开发者; 不参与别人的冲突检测与每日预算。

本地上传: `AIOA_SERVER=... AIOA_TOKEN=<管理员 access token> node tools/plugin-dev.mjs <插件目录>` (加 `--off` 撤掉)。

客户端渲染用 `GET /api/v1/plugin-contrib/{point}`: 本账号在该扩展点上实际生效的贡献 `{ point, card, items: [{ plugin, id, ... }] }`, single 已裁决, pipeline 已排序。

## 握手三档与支持窗口

客户端在 `/api/v1/stream?pv=<协议大版本>` (或 `GET /api/v1/compat?pv=`) 上带自己的协议版本, `welcome.compat` 给出档位 `{ level, server, min, msg? }`。支持窗口是最近 2 个协议大版本 (`min = server - 1`)。

| level | 条件 | 客户端 |
| --- | --- | --- |
| `ok` | 同版本, 比服务端新, 或没带 pv (老客户端) | 照常 |
| `update` | 在窗口内但低于服务端 | 提示建议更新, 照常能用 |
| `floor` | 低于窗口 | 照常连, 新功能 (插件市场等) 灰掉, 提示更新 |
| `blocked` | 在 `PROTOCOL_BLOCKED` 里 (只因安全漏洞) | 流与 `/compat` 返回 426 `client_blocked` |

启动不等更新: 档位只影响提示与新功能, 不阻塞连接。

## 插件数据 pdata

集合必须在清单 `contributes.collections` 里声明, 插件要有 `data:own` 权限。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/pdata/{plugin}/{coll}?since=0&limit=200` | 增量: `{ items, rev, more, reset? }`, 按 `rev` 升序, 含墓碑 (`deleted: true`); `reset: true` 表示 since 早于回收或清除, 这一页从头给, 客户端先清空本地副本 |
| GET | `/api/v1/pdata/{plugin}/{coll}/{id}` | 单行 |
| PUT | `/api/v1/pdata/{plugin}/{coll}/{id}` | `{ "ver": 读到的版本 (新建为 0), "body": {...} }`; 版本不对返回 409 与 `current` |
| DELETE | `/api/v1/pdata/{plugin}/{coll}/{id}?ver=3` | 写墓碑 |
| POST | `/api/v1/pdata/{plugin}/{coll}` | 批量写 `{ "items": [{ "id", "ver", "body" }, { "id", "ver", "deleted": true }] }`, 一次最多 50 行, 每行独立生效; 返回 `{ items: [{ id, item? , conflict?, error? }], rev }`, 只推一次 `pdata_sync`。Agent 一轮整理多条只用一次请求 |

- 谁能用: 主人与子号用自己账号下启用了的插件; 插件 Agent 的密钥落在主人账号, 能读写本插件的集合, 读别的插件要清单里有 `data:read:<插件>.<集合>`, 不能写别人的。待办集合按群限范围: 插件 Agent 只看得到, 写得了密钥白名单里的群的行 (墓碑照给, 只露 id), 越界单行写返回 403, 批量里那一行报错。
- 校验: 声明了 `fields` 的集合只收声明过的字段且类型要对; 每行 16000 字以内; 每个 (账号, 插件) 最多 2000 行, 墓碑也算; 满了先回收最早的墓碑 (记进 `pdata_gc`), 没有墓碑可回收才拒绝。
- 内容没变不写库也不推送; 新建一行约 3 行写入 (数据行, 主键, rev 索引), 改一行约 2 行, 计入每天 10 万行写入额度。rev 取 (账号, 插件) 当前最大 rev 加 1, 只在清除数据时把下限记进 `pdata_seq`。
- 写入后推 `pdata_sync` 给该账号的界面连接 (见 `stream.md`)。

## 待办插件 (#101)

- id `hengxin666.todo` (旧 id `todo` 在 `/plugins/{id}`, `/plugins/{id}/enabled`, `/plugin-allow/{id}` 路径里作别名); 群与工作台沿用 `plugin-todo`。
- 归属: 待办归个人, 谁启用的插件, 效果和数据就归谁 (特化插件除外)。主人和子号各存各的, 互不可见; 想让别人一起看, 把他拉进自己的待办群。
- 数据: 每个账号下集合 `items`, 一行一条, id = `<群>:<待办 id>`, body `{ channel, title, note?, state, prio, src?, created, repo?, issue?, parent?, gh?, doneAt? }`, 更新时间用行的 `updated`。state 为 open / hold / doing / done (dropped 是旧数据)。除了集合声明的类型, 服务端还校验 state / prio / repo / issue / parent 取值与 id 前缀 (`checkTodoBody`)。`doneAt` (进入 done 的时间) 与 `gh` (GitHub 同步状态) 由服务端维护: 不管经旧接口还是 pdata 写, 都按上一版补齐, 客户端写的不算 (`normTodo`)。
- 升级: Hub 唤醒时一次性把旧 `todo` 表搬进 pdata, 并把白名单, 启用, 单选, 安装记录, 群里 Agent 的 `plugin` 字段中的 `todo` 改成新 id; 白名单快照补上 v2 数据声明, 版本号不变, 管理员放行 2.0.0 后整份换掉。没装过插件但用过待办接口 (库里有待办) 的部署, 用打包的清单放行并为主人启用, 只做一次; 迁移拼出的清单没有工作台, 手动重新应用时保留原工作台。Agent 密钥照用, 专属指令的待办说明换成 pdata 接口 (版本变化会提示 Agent 重拉)。
- 旧接口 `/api/v1/chats/{channel}/todos` 转发到 pdata, 保留一个大版本后删除; 启用判断与读写的数据都是调用者自己的账号 (子号要自己启用, 能看这个群就能改自己的待办), Agent 与外部接入的 key 由主人发放, 算主人账号。卸载 (停用) 待办后, 该账号的外部接入与 MCP 一起 404。关联 issue 的同步只跑主人的待办 (GitHub 授权归主人)。写入同时推 `pdata_sync` 与旧客户端认的 `chat_sync` (`topic: todos`); 经 pdata 改主人的待办也会推 `chat_sync`。
旧接口一览:

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/v1/chats/{channel}/todos` | 能读该群者, 本群 Agent | 全部待办 |
| POST | `/api/v1/chats/{channel}/todos` | 主人, 群管理员, 本群 Agent | `{ "todos": [TodoInput] }` 或单条, 按 id 合并, 内容没变不写库 |
| DELETE | `/api/v1/chats/{channel}/todos/{id}` | 同上 | 删除一条 |
| POST | `/api/v1/chats/{channel}/todos-sync` | 同上 | 立即按 GitHub 同步关联了 issue 的待办 |
| GET / POST | `/api/v1/chats/{channel}/todos-ext` | 主人 | 外部接入密钥: 列出 / 新建 `{ name, access: read\|write, hours }` (默认 24, 0 不过期) |
| DELETE | `/api/v1/chats/{channel}/todos-ext/{id}` | 主人 | 吊销 |
| GET | `/api/v1/ext/todos.md?key=` | 接入密钥 | 待办 Markdown (未完成; `all=1` 全部) |
| POST | `/api/v1/ext/mcp` | 接入密钥 | MCP (Streamable HTTP, JSON 响应): `list_todos`, 可写密钥另有 `add_todo`, `update_todo` |

待办状态: `open` 待进行, `hold` 挂起, `doing` 进行中, `done` 已完成 (`dropped` 为旧数据, 按已完成显示)。可选字段 `repo` (owner/name), `issue`, `parent` (父待办 id); `gh` 是服务端从 GitHub 同步的只读状态, `doneAt` 是完成时间。GitHub 相关接口见 [features/gh.md](../features/gh.md)。

待办变化时广播 `{ "t": "chat_sync", "topic": "todos", "channel" }` (旧客户端重拉该群待办) 与 `pdata_sync` (新客户端按 rev 增量拉)。待办接口自 #101 起转发到插件数据 pdata (`hengxin666.todo` 的 `items`), 只在调用者自己的账号启用了待办插件时可用, 保留一个大版本后删除, 新代码请用 `docs/api/plugins.md` 的 pdata 接口。类型见 `protocol/src/v1/plugin.ts`, `plugin-todo.ts`。

- 回滚: 迁移不可逆 (旧表已删), 回滚旧版服务端会看到空的待办表; 需要回滚时先用 `GET /api/v1/pdata/hengxin666.todo/items` 导出。

## 事件与扩展点

扩展点目录与基数在 `EXT_POINTS` (commands, widgets, settings, collections, push.route, message.beforeSend, core.theme.base, core.chat.renderer, core.push.transport)。内核 `PluginKernel` 按账号给出生效的贡献: single 按 "账号选择 > 管理员默认 > 唯一启用者" 裁决, pipeline 按 before / after 拓扑排序。

事件总线只在 Hub 内存分发, 至多一次, 不落库; 发送方必须在 `emits` 声明, 接收方必须在 `listens` 声明, 只送给该账号启用了的插件。要可靠就写 pdata。

## 验证

- 单元: `npm test` (清单, 冲突检测, 内核, pdata, 逐扩展点契约 `plugin-ext-contract.test.ts`, 开发插件, 握手档位)。
- 端到端: 本机 `wrangler dev --var PLUGIN_MARKET:http://127.0.0.1:8797` 后跑 `tools/e2e-plugins.mjs` (官方市场的待办插件) 与 `tools/e2e-plugin-kernel.mjs` (`tools/fixtures/plugin-market` 里的测试插件)。待办迁移: 同一个 `--persist-to` 目录先用旧版服务端跑 `AIOA_PHASE=seed tools/e2e-todo-migrate.mjs` (`AIOA_MARKET_ROOT` 指旧版的 `plugins/`), 再换新版跑 `AIOA_PHASE=check` (重启后再跑一次验证幂等)。 GitHub 插件: `tools/e2e-github-plugin.mjs` (放行, 启用, 停用 404, 再启用数据还在, purge)。GitHub 授权与待办关联: `tools/e2e-gh-todo.mjs`。开发模式与握手: `tools/e2e-plugin-dev.mjs`。hxoa 接入 (打真实 hxoa, 需 `HXOA_BASE` / `HXOA_TOKEN`): `tools/e2e-hxoa-plugin.mjs`。线上版 (插件体系之前) 升级: 同一个 `--persist-to` 目录先用旧版跑 `AIOA_PHASE=seed tools/e2e-upgrade-main.mjs` (`AIOA_MARKET_ROOT` 指旧版的 `plugins/`), 再换新版跑 `AIOA_PHASE=check` (重启后再跑一次)。
- 市场 CI: `npm run check:plugins` (`.github/workflows/plugins.yml`)。
