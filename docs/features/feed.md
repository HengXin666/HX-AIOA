# 统一推送卡片 (feed)

一批条目 (福利, 开源项目, 资讯) 用一条消息推送, App 原生绘制, 不再各自写 HTML。对应 #70, 设计稿见 [mail-feed.html](../design/mockups/mail-feed.html)。

## 格式

`POST /api/v1/messages` 或 `POST /api/v1/events` 的 `data` 里带 `feed`:

| 字段 | 说明 |
| --- | --- |
| `source` | 来源名, 如 `NodeLoc`, 用于摘要 |
| `items[]` | 1 到 50 条 |
| `items[].title` | 必填, 200 字内 |
| `items[].id` | 稳定 id (帖子 id), 默认取 `url` |
| `items[].url` / `site` | 链接与站点 (不写取 `url` 域名), 站点决定图标 |
| `items[].kind` | 本群标签的 id, 见下方 "标签"; 没设置的群为 `deal` 福利 / `oss` 开源 / `news` 资讯 / `other` |
| `items[].status` | `ok` 有效 / `go` 进行中 / `doubt` 存疑 / `dead` 失效 |
| `items[].summary` | 400 字内结论 |
| `items[].todo` | 要做什么 |
| `items[].until` | 截止日期 |
| `items[].heat` | 热度 (数字, 综合热度或浏览数) |
| `items[].likes` | 点赞数 (非负数字, 可选) |
| `items[].replies` | 评论 / 回复数 (非负数字, 可选) |
| `items[].at` | 原帖发布时间, 毫秒或 ISO (秒级时间戳也认), 存成毫秒; 不写时 App 用消息时间 |
| `items[].links[]` | 最多 4 个 `{label, url}` |

定义与校验在 `protocol/src/v1/feed.ts` (`parseFeed`, `feedText`)。没写 `text` / `title` 时服务端用 `feedText` 生成通知摘要, 一批只响一次。信息流群 (`view: feed`) 里 Agent 发带 `html` 的消息会被拒收 (422 `feed_required`, 错误里给出 feed 写法和本群标签, `server/src/feed-guard.ts`); 主人和普通文字不受影响。旧的 HTML 推送在 App 里按摘要 "【类别】a；b" 拆成条目, 点开看原卡片 (`ui/feed/FeedLegacy.kt`)。

## 展示

- 普通群: 每批是一张卡片气泡 (`ui/feed/FeedCard.kt`)。
- 群设置打开 "信息流展示" (`ChatMeta.view = "feed"`, 仅群主, 邮件群和备忘不可切换): 整个群变成信息流 (`ui/feed/FeedView.kt`), 分 今天 / 全部 / 收藏 / 用过, 按类别筛选, "只看有效"。同 id 的条目只保留最新一次。
- 右滑 = 用过了 (再滑一次取消), 左滑露出 "失效" 按钮, 点了才标记。标记与收藏存在本机 (`FeedMarks`, 每类最多 1000 条), 不同步。
- 每条都显示时间: 有 `at` 用 `at`, 否则用消息的服务端时间。站点, 摘要, 要做什么, 截止, 热度缺哪个就不画哪个, 不留空行。
- 有链接点开链接 (内置浏览器); 旧格式有原 HTML 的点开看原卡片; 两样都没有的点开看详情 (全部字段不截断, `ui/feed/FeedDetail.kt`)。

## 标签

每个信息流群有自己的标签表 (`ChatMeta.feedTags`, 版本 `feedRev`), 没设置时用默认四类。定义在 `protocol/src/v1/feed-tags.ts`。

- 标签: `{id, label, desc, color?}`; id 小写英文, label 8 字内, desc 是归类定义 (必填), color 取 orange/blue/green/red/purple/teal/pink/gray。顺序即优先级。
- 群主: 群设置 → 信息流标签 (增删改, 排序, 恢复默认); 接口 `PATCH /api/v1/chats/{c}` `{"feedTags":[...]}`, `null` 恢复默认。每次改 rev 加一。
- 专属指令列出全部标签和定义, 规定一条只打一个, 好几个都说得通时取靠前的; 标签表一变指令版本就变, Agent 会收到更新通知。
- 服务端拒收信息流群里未声明的 `kind` (400, 错误里列出可用标签)。
- Agent 追加: 先 `GET /api/v1/chat-agent/feed-tags` 拿 `{tags, rev}`, 再 `POST` 同路径 `{"rev":<rev>,"tag":{...}}`; rev 过期或重名返回 409。Agent 不能改名或删除。
- 客户端按群的标签表显示名称和颜色; 旧消息里表中没有的标签显示原 id, 中性色。今天卡片按标签顺序统计, 带状态的条目汇总为 "仍有效"。
- 测试: `tools/e2e-feed-tags.mjs`, `server/test/feed-tags.test.ts`。
