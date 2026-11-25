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
- CF 路由规则直接投给 Worker 的地址 (如 `loli@woa.qzz.io`), 账号就是这个投递地址
- 投到 AIOA 入口 `aioa@...` 时, 取 `X-Original-To` / `Delivered-To`, 再取 `To` / `Cc` 里非中转的地址
- 信头 `To` 里的中转地址 (GitHub 的 `repo@noreply.github.com`, 各家 noreply / notifications / reply+xxx) 不当账号, 存为 `mail.list`, 详情里显示 "经 ..."; 实际投递地址存为 `mail.rcpt`
- 旧版本把中转地址当成了账号, 升级时这些信归为 "未知收件人" (账号为空串, `?account=` 可筛)

发件方头像: `GET /api/v1/mail/icon/{domain}` 按主域名取网站图标 (Google 图标服务), Cache API 缓存 7 天, 没有图标回 404 (缓存 1 天), 客户端用首字母。统计 `facets` 每组带 `from` (最新一封的发件地址) 供头像使用。

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

- 每封信是 `mail` 群里的一条事件, `data.mail = { from, name, to, vendor, category, code, via, body, spoof }`; 标题是主题, 摘要是正文前 500 字
- 完整正文 (HTML 原文, 或超过 500 字的纯文本) 存 R2 (`data.file`), 库里只留摘要, 删信时随引用计数一起删; `body` 为 `html` / `text`。CF 入口的 HTML 上限 2MB。没绑 R2 时 HTML 不超过 64KB 才内联保存
- `spoof`: CF 校验头里发件域名 DMARC 失败 (经 Gmail 等可信转发时看转发方那一跳), 显示 "可疑", 带验证码也不响铃
- 同一个 Message-ID 再来只覆盖, 不重复 (HX-Email 用 `hx-email:<message_id>`)
- 另有 `mail` 索引表 (事件 id, 时间, 账号, 厂商, 分类, 发件人, 主题), 筛选, 搜索和统计只走索引; 消息删掉或清空后自动不算, 每天清理一次残留索引
- 统计在内存缓存 1 分钟, 新信到达立即失效
- 有验证码的信优先级为 "需要我", 会响铃; 其余为 "值得看"

## 查询 (主人)

- `GET /api/v1/mail?category=&vendor=&account=&q=&before=&limit=`: 按时间倒序, `q` 匹配主题与发件地址, `before` 为上一页最后一封的 `ts`, 返回 `{ messages, more }` (不带内联 HTML)
- `GET /api/v1/mail/{id}/body`: 完整正文 `{ html }`, 纯文本已转成可显示的 HTML; 没有完整正文的信返回 404
- `GET /api/v1/mail/facets`: `{ categories, vendors, accounts }`, 每项 `{ key, count, last }`

## 厂商与分类

厂商表在 `protocol/src/v1/mail.ts`: 发件域名 (含子域名) -> 厂商名 + 分类, 认不出的厂商用发件人主域名。

分类: AI, 开发, 云服务, 账号安全, 金融, 购物, 社交, 影音, 游戏, 办公, 教育, 政务, 其他。厂商表优先; 不在表里的按域名关键词猜 (如 `.edu` 归教育, `bank-` 开头的段归金融), 都不中归 "其他"。旧库升级时按发件人补上分类。

计划: 用户自定义映射表 (域名 -> 厂商 / 分类 / 图标), 图标可取邮件里的 BIMI 标志 (`BIMI-Location` 头) 作为权威来源。

## 详情显示 (#46)

- 原文直接内嵌 (WebView 不跑脚本, 不读文件), 按屏宽排版; 设计稿 `docs/design/mockups/mail-detail.html`
- 远程图片: 白名单 (上面的厂商表, 含子域名) 默认放行, 其余拦截; 冒充的信 (spoof) 只认明确放行。详情里可 "显示" (本次) 或 "总是显示" (记到发件人主域名)
- 样式: 深色适配 (默认, 深色主题下反色, 图片不反) / 原样 / 纯文本, 按发件人主域名记住
- 点链接先弹出真实去向: 跳转参数 (url, u, redirect 等) 里带目标的直接解开, 去掉跟踪; 只走内置浏览器或复制
- 验证码只取 "验证码 / code" 字样附近, 中间不隔句读, 年份 (19xx / 20xx) 不算

偏好存服务端, 各端共用:

- `GET /api/v1/mail/prefs`: `{ images, senders, known }`。`images`: `known` (只放行白名单, 默认) / `all` / `none`; `senders`: 键为小写地址或域名, 值 `{ images?: show|block, style?: adapt|original|text }`, 地址优先, 域名逐级往上找; `known`: 白名单域名 (只读)
- `PUT /api/v1/mail/prefs`: `{ images, senders }`, 最多 500 个发件人

## 转进群 / 交给 Agent (#46)

- `POST /api/v1/mail/{id}/forward` `{ channel }`: 以主人的名义发到群里: 标题, 发件人, 收件, 时间, 纯文本正文 (超过 3500 字截断), 原文作附件, `fwd.channel = "mail"`。来源是主人, 所以群里监听的 Agent 会被叫醒。群不存在 404
- `GET / PUT /api/v1/mail/rules` `{ rules: [{ id, on, from?, domain?, category?, subject?, to?, channel, keep }] }`: 自动转发, 条件全部满足才转 (至少一个条件), `subject` 为标题关键词, `domain` 含子域名。新信到达时服务端执行, 同一个群只转一次; `keep=false` 转完从邮件列表删掉。冒充的信不转。规则转过的信 30 天内重投直接忽略 (删掉的不会复活)。最多 50 条
