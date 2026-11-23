# 邮件聚合

所有邮箱的信汇到一个 "邮件" 群, 群用邮件视图展示: 按时间, 按厂商 (GPT, GitHub ...), 按收件账号筛选。

HX-AIOA 只负责 "自己看": 聚合, 分组, 验证码提醒。收发信, OAuth, IMAP 轮询, 邮箱池这些消息总线的事归 HX-Email。

## 入口

### 1. CF 邮件路由 (主入口)

Worker 导出了 `email()`, 收到的信在 Worker 里解析 (postal-mime), 再交给 Hub 入库。

在 CF 后台, 收件域名 → 电子邮件 → 电子邮件路由 → 路由规则:

- 新建 "自定义地址", 例如 `aioa@<域名>`, 操作选 "发送到 Worker", Worker 选 `hx-aioa`
- 精确地址规则优先于 catch-all, 不影响同域名下已有的临时邮箱

收件账号的判断:

- Gmail 自动转发带 `X-Forwarded-For: 原地址 目标地址`, 账号取原地址
- Outlook 等保留原 `To`, 账号取 `To` 的第一个地址
- 直接发到这个地址的信, 账号就是这个地址

Gmail 开转发时会先往目标地址发一封确认信, 它会出现在邮件群里, 点开里面的链接即可。

超过 10MB 的信直接拒收。

### 2. HX-Email Webhook

HX-Email → 设置 → 通知 → Webhook:

- URL: `https://<服务端域名>/api/v1/mail/hx-email`
- Token: 一把带 `events:write` 的接入 key (建议频道白名单只填 `mail`)

收的就是 HX-Email `new_mail` 事件原样, 收件账号取 `usable_email.address`, 带上它提取的验证码。`test` 事件直接返回 200。

站点开了 Bot Fight 时, 非浏览器 UA 会被拦, 需要在 CF 后台给 `/api/v1/mail/*` 加一条跳过挑战的规则。

### 3. 通用推送

`POST /api/v1/mail`, 同样要 `events:write`:

```json
{ "from": "noreply@github.com", "name": "GitHub", "to": "me@gmail.com", "subject": "...", "text": "...", "html": "...", "messageId": "<...>", "ts": 1764000000000 }
```

`from`, `to` 必填, `subject` / `text` / `html` 至少一个。

## 存储

- 每封信是 `mail` 群里的一条事件, `data.mail = { from, name, to, vendor, code, via, body, spoof }`; 标题是主题, 摘要是正文前 500 字
- 完整正文 (HTML 原文, 或超过 500 字的纯文本) 存 R2 (`data.file`), 库里只留摘要, 删信时随引用计数一起删; `body` 为 `html` / `text`。CF 入口的 HTML 上限 2MB。没绑 R2 时 HTML 不超过 64KB 才内联保存
- `spoof`: CF 校验头里发件域名 DMARC 失败 (经 Gmail 等可信转发时看转发方那一跳), 显示 "可疑", 带验证码也不响铃
- 同一个 Message-ID 再来只覆盖, 不重复 (HX-Email 用 `hx-email:<message_id>`)
- 另有 `mail` 索引表 (事件 id, 时间, 账号, 厂商, 发件人, 主题), 筛选, 搜索和统计只走索引; 消息删掉或清空后自动不算, 每天清理一次残留索引
- 统计在内存缓存 1 分钟, 新信到达立即失效
- 有验证码的信优先级为 "需要我", 会响铃; 其余为 "值得看"

## 查询 (主人)

- `GET /api/v1/mail?vendor=&account=&q=&before=&limit=`: 按时间倒序, `q` 匹配主题与发件地址, `before` 为上一页最后一封的 `ts`, 返回 `{ messages, more }` (不带内联 HTML)
- `GET /api/v1/mail/{id}/body`: 完整正文 `{ html }`, 纯文本已转成可显示的 HTML; 没有完整正文的信返回 404
- `GET /api/v1/mail/facets`: `{ vendors, accounts }`, 每项 `{ key, count, last }`

厂商表在 `protocol/src/v1/mail.ts`, 认不出的用发件人主域名。
