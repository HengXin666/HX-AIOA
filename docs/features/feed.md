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
| `items[].kind` | `deal` 福利 / `oss` 开源 / `news` 资讯 / `other` |
| `items[].status` | `ok` 有效 / `go` 进行中 / `doubt` 存疑 / `dead` 失效 |
| `items[].summary` | 400 字内结论 |
| `items[].todo` | 要做什么 |
| `items[].until` | 截止日期 |
| `items[].heat` | 热度 (数字) |
| `items[].links[]` | 最多 4 个 `{label, url}` |

定义与校验在 `protocol/src/v1/feed.ts` (`parseFeed`, `feedText`)。没写 `text` / `title` 时服务端用 `feedText` 生成通知摘要, 一批只响一次。`html` 仍可用, 但只作兜底。

## 展示

- 普通群: 每批是一张卡片气泡 (`ui/feed/FeedCard.kt`)。
- 群设置打开 "信息流展示" (`ChatMeta.view = "feed"`, 仅群主, 邮件群和备忘不可切换): 整个群变成信息流 (`ui/feed/FeedView.kt`), 分 今天 / 全部 / 收藏 / 用过, 按类别筛选, "只看有效"。同 id 的条目只保留最新一次。
- 右滑 = 用过了, 左滑 = 标记失效 (再滑一次取消)。标记与收藏存在本机 (`FeedMarks`, 每类最多 1000 条), 不同步。
- 链接一律走内置浏览器。
