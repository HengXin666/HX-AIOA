# HX-AIOA API v1: WebSocket 流

HTTP 接口与数据类型见 [接口总览](v1.md)。本文是 `/api/v1/stream` 的帧契约。

## 1. 连接

```
wss://<域名>/api/v1/stream?token=<凭证>&role=<client|agent|probe|chat>&device=<设备 id>&since=<已收到的最大 seq>
```

| 参数 | 说明 |
| --- | --- |
| `token` | `client` 用访问令牌 `hxa_` (或旧 `AUTH_TOKEN`); `agent` 用带 `agent` scope 的 `hxk_`; `probe` 用带 `probe` scope 的 `hxk_`; `chat` 用群 Agent 带 `events:read` 的 `hxk_` |
| `role` | 默认 `client` |
| `device` | 设备 id。以 `android` 开头的视为手机, 参与 ack 与兜底推送判断; 探针必须是 `probe-<subject>` |
| `since` | 可选, `client` 与 `chat`。服务端先补发 `seq > since` 的事件 (最多 500 条, 更多请用 `GET /api/v1/events` 分页) |

- 访问令牌过期不会断开已建立的连接; 被踢下线或改密码时服务端用关闭码 `4001` 关闭, 客户端应回到登录页而不是重连。凭证无效时握手返回 HTTP 401。
- 心跳: 客户端发纯文本 `ping`, 服务端自动回 `pong` (不唤醒服务端, 不计费)。建议 25-30 秒一次。
- 所有业务帧都是 JSON 文本, 用 `t` 区分类型。未知 `t` 应忽略 (向前兼容)。
- 旧的 `/ws` 端点仍可用, 只收到旧 `msg` 帧, 见 `protocol/README.md`。

## 2. 客户端 (role=client)

### 2.1 服务端 → 客户端

**welcome** 连接成功后第一帧 (多账号未实现前没有 `user` 与 `session`):

```json
{ "t": "welcome", "v": 2, "head": 42, "now": 1763712000000, "role": "client", "session": "s_9f2k1m0c7x",
  "user": { "id": "u_k3j9x2m1qa", "name": "hengxin", "display": "HengXin", "role": "owner", "status": "active", "created": 1763712000000 } }
```

**probes** 在线探针主体 (连上时一次, 变化时再发):

```json
{ "t": "probes", "subjects": ["nas-01", "vps-1"] }
```

**ev** 一条进入收件箱的事件 (补拉与实时相同)。同 `id` 已存在时整体替换:

```json
{ "t": "ev", "ev": { "id": "e_3fa9c1d2b7e04a18", "seq": 43, "ts": 1763712000000, "kind": "event",
  "source": { "id": "src_x1", "name": "群晖 NAS", "icon": "server", "type": "webhook" },
  "subject": "nas-01", "channel": "nas/alerts", "priority": "need_me", "dedupeKey": "disk-sda",
  "data": { "title": "磁盘 sda 故障", "severity": "critical", "status": "firing" },
  "route": { "action": "alert", "channels": ["ws", "mipush", "wxpusher"], "rule": "builtin:need-me" } } }
```

客户端据 `ev.route.action` 决定提醒方式: `alert` 响铃 + 横幅, `push` 普通通知, `silent` / `digest` / `aggregate` 只更新界面。补拉 (`seq <= welcome.head`) 的事件不应再弹通知。安卓 `:link` 进程收到后应回 `ack`。

**agents** Agent 列表与在线状态 (连上时一次, 注册信息或上下线变化时再发, 整份替换):

```json
{ "t": "agents", "agents": [ { "id": "dsh", "name": "DSH", "icon": "bot", "online": true, "lastSeen": 1763712000000, "mode": "ws" } ] }
```

**task_log** 任务对话与执行历史的增量 (完整历史用 `GET /api/v1/tasks/{id}`):

```json
{ "t": "task_log", "taskId": "deploy-42", "entry": { "ts": 1763712030000, "role": "agent", "kind": "say", "text": "镜像已推送" } }
```

`role`: `agent` | `user` | `system`; `kind` 为任务操作 (`create`, `say`, `wait`, `done`, `fail`) 或用户动作 (`approve`, `reject`, `reply`, `cancel`, `ask`), 超时为 `timeout`。

**task** 任务快照实时更新 (进度变化也会推, 进度不一定落库):

```json
{ "t": "task", "task": { "id": "deploy-42", "agent": "dsh", "title": "部署到生产", "state": "running", "progress": 0.4, "step": "构建镜像", "created": 1763712000000, "updated": 1763712030000 } }
```

**act_ok** 用户动作回执:

```json
{ "t": "act_ok", "aid": "a_8x1", "state": "delivered" }
```

`state`: `delivered` (Agent 在线已推送) / `queued` (Agent 离线, 排队) / `duplicate` (该 aid 已处理过)。

**presence** 群里谁在监听 / 输入, 只在名单变化 (或快到期需要续期) 时推, 不落库。`until` 为到期时间, 客户端到点自己隐藏; 没有 `until` 的是长连着的 Agent。群资料 `hideListening` / `hideTyping` 为 true 时对应名单恒为空。连上时有人的群各补一帧:

```json
{ "t": "presence", "channel": "plugin-todo", "listening": [ { "id": "k_x1", "name": "点子整理" } ], "typing": [ { "id": "user:u_k3j9", "name": "HengXin", "until": 1763712006000 } ] }
```

**metric** 实时指标, 只发给 `watch` 了该主体的连接, 不落库:

```json
{ "t": "metric", "subject": "nas-01", "points": [ { "ts": 1763712000000, "values": { "cpu": 37.5, "mem": 61.2 } } ] }
```

探针首次被看时会先发一帧 `"history": true` 的本地历史。通过 HTTP 写入的 `metric` 事件也会转成这个帧发给在看的连接。

**space_update** 工作台布局变化:

```json
{ "t": "space_update", "id": "servers", "space": { "id": "servers", "title": "服务器", "origin": "key:k_p1x", "updated": 1763712000000, "panels": [] } }
{ "t": "space_update", "id": "servers", "deleted": true }
```

**settings** 其它设备改了设置 (整份):

```json
{ "t": "settings", "settings": { "appearance": { "theme": "dark" }, "tz": "Asia/Shanghai" } }
```

**overview** 回应 `overview` 请求, 内容同 `GET /api/v1/overview`:

```json
{ "t": "overview", "overview": { "layers": { "need_me": [], "happening": [], "worth_reading": [] }, "tasks": [], "generatedAt": 1763712000000 } }
```

**sent** / **err**:

```json
{ "t": "sent", "cid": "c_1", "seq": 44, "ts": 1763712000000 }
{ "t": "err", "code": "need_confirm", "text": "危险动作需要二次确认", "aid": "a_8x1" }
```

`err.code` 与 HTTP 错误码一致 (`bad_request`, `forbidden`, `need_confirm`, `expired`, `not_found`), 与动作相关时带 `aid`。

### 2.2 客户端 → 服务端

| 帧 | 例子 | 说明 |
| --- | --- | --- |
| `ack` | `{ "t": "ack", "seq": 43 }` | 已展示到 seq, 仅 `android*` 设备参与兜底推送判断 |
| `reg` | `{ "t": "reg", "pushToken": "MiPush regId" }` | 上报厂商推送 token |
| `watch` | `{ "t": "watch", "subjects": ["nas-01"] }` | 在看的指标主体, 整体替换, `[]` 表示不看 |
| `send` | `{ "t": "send", "cid": "c_1", "body": { "kind": "text", "text": "你好" } }` | 发一条文字到自己的收件箱 (备忘 / 测试), 回 `sent`, 该事件 `route.action` 为 `silent`, 不触发兜底推送 |
| `act` | `{ "t": "act", "aid": "a_8x1", "taskId": "deploy-42", "kind": "approve", "option": "go", "confirm": true }` | 用户动作, 语义同 `POST /api/v1/tasks/{id}/actions` |
| `overview` | `{ "t": "overview" }` | 请求总览, 回 `overview` |
| `typing` | `{ "t": "typing", "channel": "plugin-todo" }` | 正在这个群输入; 输入期间最多每 4 秒一次, 约 6 秒后自动消失, 发出消息立即消失 |

## 3. Agent (role=agent)

连接后服务端发 `welcome` (`role: "agent"`, 无 `user`); Agent 发 `agent_hello` 后, 服务端把该 agent 排队中的用户动作逐条以 `act` 帧发来。

### 3.1 Agent → 服务端

```json
{ "t": "agent_hello", "agent": { "id": "dsh", "name": "DSH", "icon": "bot", "desc": "家里的运维 Agent" } }
{ "t": "task", "taskId": "deploy-42", "op": "create", "title": "部署到生产", "subject": "vps-1" }
{ "t": "task", "taskId": "deploy-42", "op": "progress", "progress": 0.4, "step": "构建镜像" }
{ "t": "task", "taskId": "deploy-42", "op": "say", "text": "镜像已推送" }
{ "t": "task", "taskId": "deploy-42", "op": "wait", "prompt": { "question": "切换生产流量?", "options": [ { "id": "go", "label": "切换", "style": "danger" }, { "id": "hold", "label": "先不" } ], "danger": true, "timeoutSec": 1800 } }
{ "t": "task", "taskId": "deploy-42", "op": "done", "result": "完成" }
{ "t": "task", "taskId": "deploy-42", "op": "fail", "error": "健康检查失败" }
{ "t": "act_ack", "aid": "a_8x1" }
```

`agent_hello` 应在连上后先发, 决定在线状态里的名字, 服务端随即补发排队中的动作; 一个 key 可以用多个连接各自声明不同的 agent id。每个 `task` 帧服务端回一帧 `task` (最新快照) 作为回执, 出错回 `err`。

### 3.2 服务端 → Agent

```json
{ "t": "act", "action": { "aid": "a_8x1", "taskId": "deploy-42", "kind": "approve", "option": "go", "confirm": true, "ts": 1763712100000, "user": "hengxin", "promptId": "p_1" } }
```

Agent 处理后回 `act_ack`; 没有 ack 的动作在下次连上时会重发 (24 小时内), 所以 Agent 要按 `aid` 去重。工作台按钮产生的动作 `taskId` 为 `button:<spaceId>:<itemId>`, `text` 为按钮的 `command`。

## 3.5 群 Agent 长连 (role=chat)

`hxaioa watch` 用的就是它。`welcome` 带 `me` (`keyId`, `name`, `channel`, `sourceId`, `reads`), 之后补发 `since` 之后可读群里的事件, 再实时推 `ev` (只推 key 白名单里的群)。可发 `typing` 帧, 其它帧忽略。主人改了群资料, Agent 设置, 插件或 GitHub 授权后, 这把 key 的专属指令版本若变了, 服务端立刻推 `{ "t": "guide", "channel": "...", "version": "..." }` (同时在群里发一条系统通知), 不等 Agent 下次请求。连着期间这些群的 `presence.listening` 里有它; 断开即移除。

## 4. 探针 (role=probe)

`device` 必须以 `probe` 开头; key 需要 `probe` scope, 若 key 绑定了 `subject` 则 `device` 必须是 `probe-<subject>` (旧 `AUTH_TOKEN` 不限)。`probe_config` 帧尚未实现。

| 方向 | 帧 | 说明 |
| --- | --- | --- |
| 服务端 → 探针 | `{ "t": "welcome", "v": 2, "head": 0, "now": ..., "role": "probe" }` | |
| 服务端 → 探针 | `{ "t": "probe_config", "subject": "nas-01", "config": { "idleSampleMs": 60000, "liveIntervalMs": 2000, "alerts": { "cpu": 90 } } }` | 连上时 (若有配置) 与配置变更时 |
| 探针 → 服务端 | `{ "t": "offer", "subjects": ["nas-01"] }` | 能提供的主体 |
| 服务端 → 探针 | `{ "t": "demand", "subjects": ["nas-01"], "intervalMs": 2000 }` | 有人在看, 开始推; `[]` 表示停 |
| 探针 → 服务端 | `{ "t": "metric", "subject": "nas-01", "points": [ { "ts": ..., "values": { "cpu": 12.5 } } ], "history": true }` | 指标点 |

告警在探针本地判断, 通过 `POST /api/v1/events` 发送 (`dedupeKey: "alert:<subject>:<指标>"`, 恢复时 `status: "resolved"` 覆盖同一条)。
