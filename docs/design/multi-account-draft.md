# 多账号与消息中枢 API 设计 (草案)

> 状态: 早期草案, 已被 2026-11-23 的单库方案取代 (一个 Hub 库, 成员与邀请见 [接口总览](../api/v1.md) §1.4 到 §1.7), 只留作背景。

## 1. 账号模型
- **实例**: 一个域名 = 一套部署。
- **用户**: 三种角色 `owner` (母号, 唯一) / `admin` / `member`。每个用户独立拥有: 工作台与面板, 外观设置, 设备, 收件箱 (消息序号, 已读), 自己的 Agent 和接入 key。
- **群组**: 如「家人」「团队」, 用来共享工作台和批量推送。
- **加入流程**: 管理员生成邀请链接 / 码 (一次性, 带过期时间和角色) → 对方在 App 里注册 → 可选「需管理员批准」。不开放自由注册。
- **首次安装**: 用部署时的一次性初始化码创建母号, 用完即失效, 替代现在的全局 AUTH_TOKEN。

## 2. 三类凭证, 各管各的
| 凭证 | 给谁 | 能做什么 |
|---|---|---|
| 设备会话 | 手机 / 电脑 | 短期访问令牌 + 可吊销的刷新令牌, 每台设备一个, 设置里可踢下线 |
| 接入 key | NAS, GitHub webhook, 脚本, Agent | 只写不读, 带权限范围 (`messages:send` `events:write` `spaces:write`) 和可发送的频道白名单, 可限速 |
| 初始化码 | 部署者 | 只用一次 |

- 所有 key 只存哈希, 创建时只显示一次, 带前缀方便识别 (`hxk_...`)。
- 签名密钥只在 CF secret, 仓库和 APK 里没有任何密钥。
- 关键操作 (建号, 发 key, 改角色, 吊销) 记审计日志。

## 3. 消息路由: 频道 + 订阅
- 外部系统发到**频道** (如 `nas/alerts`, `github/hx-aioa`), 不写收件人。
- 用户或群组**订阅**频道, 可设优先级阈值, 静音时段。
- 需要点名时也支持直发: `to: ["user:mom", "group:family", "role:admin"]`。
- 好处: 加人 / 换人不用改任何接入脚本; 家人只订阅「家庭」相关, 不会被你的服务器告警打扰。

## 4. 不让它退化成邮箱
消息不是一段文字, 而是结构化事件:
- `priority` (需要我 / 正在发生 / 值得一看), 决定去哪层, 是否响铃。
- `dedupe_key` 同一件事更新而不是刷屏; `group_key` 关联告警合并。
- `actions` 可直接操作 (静音, 接受, 重启), 回调到来源。
- `ttl` 过期自动收起, `resolved` 闭环。

## 5. API (v1 草案)
```
# 账号
POST   /api/v1/setup              初始化码创建母号
POST   /api/v1/auth/login | refresh | logout
GET    /api/v1/me   DELETE /api/v1/me/devices/{id}
POST   /api/v1/invites            admin 发邀请
POST   /api/v1/join               用邀请注册
GET|PATCH|DELETE /api/v1/users/{id}   admin
CRUD   /api/v1/groups
# 路由
CRUD   /api/v1/channels   CRUD /api/v1/subscriptions
CRUD   /api/v1/keys               接入 key (属于某个用户)
# 数据
POST   /api/v1/messages           发到频道或 to
POST   /api/v1/events             指标 / 状态
CRUD   /api/v1/spaces             当前用户的工作台
POST   /api/v1/actions/{id}       用户点了操作按钮
WS     /api/v1/stream             客户端长连接
```

## 6. CF 上怎么放
- **目录 DO** (一个): 用户, 群组, key, 频道, 订阅。读多写少。
- **用户 DO** (每人一个): 自己的收件箱, seq, WS 连接, 工作台, 设置。现在的 Hub DO 就是它的雏形, 改动最小。
- 流程: 接入 key 校验 → 目录 DO 解析收件人 → 扇出到各用户 DO → WS / 小米推送。
- 人与人天然隔离, 一个人的数据不会误发给另一个。扇出会放大写入量, 家庭 / 小团队规模在免费额度内。

## 7. 顺序
这是地基, 排在 #2 事件模型之前或一起定。UI 画廊用 mock 数据并行推进, 不受影响。
