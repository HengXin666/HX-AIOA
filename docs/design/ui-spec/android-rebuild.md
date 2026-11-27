# 安卓前端全量重构: 计划与接口对账 (#121)

目标: 按 #121 定稿 (总览 v2, 消息页 v2, 群资料, Agent 设置, 待办树) 重做安卓前端, 下个大版本发布。原则: CF 额度最省, 性能最优, 在此前提下最实时。设计稿与说明见 [home-spaces.md](home-spaces.md), [message-pages.md](message-pages.md)。

## 分期

| 期 | 内容 | 依赖的服务端改动 |
| --- | --- | --- |
| P0 外壳 | 侧栏 + 顶部标签替换底部五栏 (`HomeFrame`); 子页不叠外壳; 平板保留左侧导航; `pages.json` 改 `tab` 说明, 跑 `gen.py`, 补 `TabNavTest` | 无 |
| P1 总览 v2 | 概况, 今日脉搏, 需要我, Agent, 资源, GitHub, 插件区块; 入场与图表动效 | 提交热力格要按天计数 (见下) |
| P2 消息列表 | 一列, 置顶折叠, 域 (一行, 点进去一组群), 标签筛选 | 无 (设置键 `chatTags`) |
| P3 会话页 | QQ 结构, 输入栏 (表情第一, 无 @ / Agent 钮), 输入 @ 选择, 长按两排操作, 多选, 合并转发卡片, 点 / 长按头像 | 合并转发, @ 提醒 |
| P4 群资料 | 群聊设置, 成员与 Agent, 资料卡, Agent 设置 (按 #117) | 成员分页 / ETag / 头像 |
| P5 待办树 | 缩进列表 + 层级连线 (`Modifier.treeGuides`, 已接入 NodeRows), 看板保留 | 无 (用 `parent`) |
| P6 省额度 | 见 message-pages.md 第 4, 5, 7 节 | 已读拆表等 |

语音输入先不做 (交给输入法), 输入栏留位置。

## 接口对账: 现有接口能不能撑住

| 需求 | 现有接口 | 结论 |
| --- | --- | --- |
| 需要我 / 正在发生 / 值得一看 | `GET /overview` 三层 + 任务, WS 推增量 | 够用 |
| 今日脉搏 (24 小时消息与 Agent 曲线) | 无 | 不加接口: 本地消息库按小时聚合 (加一条本地查询); Agent 运行次数从 `ChatAgent.lastRun` 与任务帧累计 |
| 资源卡 (负载 + 走势) | `metrics/latest` + WS `watch` | 够用; 总览只订阅在看的主机, 离开页面退订 |
| GitHub 提交热力格 | `github/daily` 只有当天 | **缺**: 服务端在已有每日 cron 里按天记一行计数 (最近 20 周), 总览读这一行, 带 ETag |
| Agent 卡片 (进度, 状态, 下次触发) | `ChatMeta.agents` (`trigger` `lastRun` `skills` `pending`) | 够用; `active` 的推送有 bug, 见下 |
| 插件区块 | 插件 `space.panels` + pdata | 够用 |
| 域 | 设置 `chatFolders` | 够用 |
| 标签 | 无 | 新设置键 `chatTags`, 走现有设置同步, 不加接口 |
| 置顶折叠 | `ChatMeta.pinned` | 够用 (折叠是纯客户端) |
| @ 选择列表 | 成员 `GET /chats/{c}/members` + `ChatMeta.agents` | 能用, 但成员要分页与缓存 |
| @ 提醒 (免打扰也响) | 无, 服务端不认识 @ | **缺**: 消息带 `mentions: [uid | keyId | "all"]`, 服务端按它决定推送与通知; Agent 的 `next` 里标出被 @ |
| 撤回 / 删除 | `recall.ts` 墓碑 | 够用; 撤回时限按 QQ 定 (自己 2 分钟, 管理员随时) 需服务端校验 |
| 逐条转发 | WS `send` 的 `fwd` | 够用 |
| 合并转发 | 无 | **缺**: 一条消息带 `bundle: { from, count, refs: [seq], head }`, 只存引用; 批量取 `GET /events/seq?seqs=` (**缺**, 现在只能一条一条) |
| 群文件 | 群历史 `data.file` | 够用 (本地筛 + 翻页) |
| 群公告 | 无 | 新 `ChatMeta.notice`, 走 `PATCH /chats/{c}` |
| 成员列表 | 全量, 无 ETag, 无头像 | **要改**: 游标分页, 搜索, ETag, `avatar` |
| 资料卡 (入群时间, 身份) | 成员列表 | 够用; "最近发言 / 本群条数" 本地算 |
| Agent 设置 | `PATCH .../agents/{keyId}` (`name` `reads` `autoMajor`), `rotate`, 接入语 | 够用 (记忆不由我们维护) |
| 待办树 | pdata `items.parent` | 够用; 树在客户端建 |

## 对接是否合理: 新界面对性能要求更高的地方

| 位置 | 问题 | 改法 | 省什么 |
| --- | --- | --- | --- |
| 已读上报 | 每次已读改群资料并广播, 全端整表重拉 `/chats` | `chat_read` 表 + `chat_read` 帧带值 | 每次已读 N 次整表读与下载 |
| Agent 活跃时间 | 每 2 分钟广播, ETag 不变, 客户端拿 304, 值到不了 | 内存记录, 随 presence 帧带值, 延迟落库 | 每台设备每 2 分钟 1 次请求; 修显示 |
| `chat_sync` | 只是 "去重拉" 的信号, 且发给所有人 | 帧里带变化的那一行, 只发给群成员 | 每次群资料变化 N 次请求 |
| `/chats` 的 304 | 要读全部群才算得出 ETag | 版本号做 ETag | 每次冷启动的整表读 |
| `roomsOf(uid)` | 按 member 查走全表 | 加索引 | 子号每次拉群列表 |
| 推送受众 | 每条消息遍历所有连接 | 按群维护在线连接 | DO CPU |
| 总览打开 | 各卡片各自拉 | 一次 `overview` + 本地库 + 已有 WS; 图表数据本地算 | 打开总览约 1 次请求 |
| 会话页图片 / 头像 | 头像按 id 永久缓存 (已有) | 成员头像也走 id | 重复下载 |

## 每期完成的标准

- 真实 Compose 截图 (画廊) 与真机截图各一份, 明暗两套。
- `:app:compileDebugKotlin`, `:app:testDebugUnitTest`, `:ui:desktopTest` 通过 (贴退出码)。
- 改页面或跳转: `pages.json` → `gen.py` → 入口清单 → `TabNavTest`。
- 服务端改动单独提交, 带测试与 CF 请求数说明。

## 接口契约 (实现用, 2026-11-27 定)

服务端先改 `protocol/src/v1`, 安卓按下面的形状对接; 全部可选字段, 旧端忽略。

| issue | 形状 |
| --- | --- |
| #129 | `ChatMeta` 不再因已读改 `updated`; 已读存 `chat_read`, 推 `{ t: "chat_read", channel, read }` 给本人其它设备。`chat_sync` 帧可带 `chat: ChatMeta` (按收帧人的视图), 只发给该群成员 (主人总收)。`GET /chats` 的 ETag 用版本号。Agent 活跃: 推 `{ t: "agent_active", channel, keyId, active }`, 内存记录, 最多每 30 分钟落库一次 |
| #130 | `GET /chats/{c}/members?cursor=&limit=&q=` → `{ members, next? }`, 带 ETag; `RoomMember.avatar?`; `room_member` 加 `member` 索引 |
| #131 | WS `send` 帧可带 `mentions: string[]` (uid, `agent:<keyId>`, `all`); 消息 (Envelope) 带 `mentions`; 被 @ 的人即使免打扰也提醒; Agent `next` 的条目带 `mentioned: true` |
| #132 | WS `send` 帧可带 `bundle: { from: string, seqs: number[] }` (最多 100 条) → 新消息 `data.bundle = { from, count, refs: number[], head: [{ src, text }] }` (head 最多 4 条, text 截 60 字), 正文 `[聊天记录] <from>`; `GET /api/v1/events/seq?seqs=1,2,3` 批量取 (最多 100) → `{ events: [Envelope] }` |
| #133 | `ChatMeta.notice` (≤500 字), `PATCH /chats/{c}` 群主 / 管理员可改; 单聊 `POST /api/v1/dms { peer }` → `{ chat }`, channel `dm:<小 uid>:<大 uid>`, `kind: "dm"`, `peer` 为对方; dm 群不能接 Agent, 不能邀请, 不能加人 (400) |
| #134 | `GET /api/v1/github/heatmap` → `{ days: [{ date: "YYYY-MM-DD", commits }], updated }` 最近 140 天, 每日 cron 里算好存一行, 带 ETag |
