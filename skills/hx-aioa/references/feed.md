# 信息流 (feed) 推送

简报里展示方式是 feed 的群, 推送一批条目只发 feed 消息, 一批只发一条; 带 HTML 卡片的消息会被拒收 (422 `feed_required`)。

```bash
hxaioa api POST /api/v1/messages '{"feed":{"source":"<来源名>","items":[{"id":"<帖子 id>","title":"标题","url":"https://...","kind":"deal","status":"ok","summary":"结论和关键时间","todo":"怎么拿到","until":"2026-11-30","heat":12,"likes":30,"replies":8,"at":"2026-11-25T09:30:00+08:00"}]}}'
```

## 字段

- `title` 必填, 200 字内; 其余可选。一次 1 到 50 条, `text` 可以不写, 服务端生成通知摘要。
- `status`: `ok` 有效, `go` 进行中, `doubt` 存疑, `dead` 失效。
- `summary` 400 字内, 写结论和关键时间; `todo` 写要做什么才能拿到; `until` 截止日期。
- `heat` 热度 (综合热度或浏览数), `likes` 点赞数, `replies` 评论数; 拿不到就不写。
- `at` 原帖发布时间 (ISO 或毫秒), 不写用推送时间; `links` 最多 4 个 `{label,url}`。
- `id` 写帖子 id 这类稳定值: 同一条再推时只保留最新, 已失效的可以带 `status: dead` 再推一次。

## 标签 (kind)

- 只能用简报标签表里的 id, 按内容判定, 不看发帖版块。一条只打一个; 几个都说得通时取排在前面的, 同一个东西每次落进同一个标签。用了表里没有的会被拒收。
- 表里长期缺一类东西 (不是一次两次) 才追加: 先 `hxaioa api GET /api/v1/chat-agent/feed-tags` 看全表和 rev, 再 `hxaioa api POST /api/v1/chat-agent/feed-tags '{"rev":<rev>,"tag":{"id":"小写英文","label":"8 字内","desc":"归这一类的东西, 与已有标签怎么区分"}}'`。
- rev 对不上说明别人刚改过, 重新拉表再判断。不改名, 不删除已有标签, 那是主人的事。
