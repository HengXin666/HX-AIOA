# 消息协议

本目录是客户端与服务端共用协议的唯一真源。

| 文件 | 内容 |
| --- | --- |
| `src/index.ts` | 旧 `/ws` 帧 (本文下半部分) 与公共常量, 并导出 v1 全部类型 |
| `src/v1/event.ts` | 统一事件信封 `Envelope`, 四种 kind, 事件组 `EventGroup`, 合并工具 `mergeEnvelope` |
| `src/v1/rule.ts` | 规则 `Rule` / 时间窗 / 解析 |
| `src/v1/task.ts` | Agent, 任务快照, 任务操作, 用户动作 |
| `src/v1/source.ts` | 来源类型, Webhook 适配器 id, 拉取任务约定, 映射模板 |
| `src/v1/frames.ts` | `/api/v1/stream` 新增帧 |
| `src/v1/api.ts`, `src/v1/paths.ts` | HTTP 请求与响应类型, 路径常量 |
| `src/v1/space.ts` | 工作台 schema: 组件类型与分类, 数据绑定, 校验 `validateSpace` |
| `src/v1/space-layout.ts` | 工作台显示状态 (排序, 尺寸, 隐藏) 的解析与排序, 服务端解析的当前值 `SpaceData` |
| `src/v1/metric-fields.ts` | 标准指标字段与各来源 (探针, Beszel, Netdata, Prometheus) 的别名 |

v1 契约见 `docs/api/v1.md`, `docs/api/stream.md`, `docs/api/connectors.md`, `docs/api/spaces.md`。下文是旧版 `/ws` 协议, 继续可用: 服务端内部已统一为事件模型, 旧客户端收到的 `msg` 帧由事件压成一行文本生成, `seq` 与新模型连续。

## 旧版 /ws 协议

传输: WebSocket 文本帧, 内容为 JSON。心跳单独使用纯文本 `ping` / `pong`, 由服务端自动应答, 不计入业务帧。

### 连接

```
wss://<域名>/ws?token=<令牌>&device=<设备 id>&since=<已收到的最大 seq>
```

- `device`: 设备唯一 id。以 `android` 开头的设备视为手机, 参与兜底推送判断。
- `since`: 可选, 服务端会先补发 `seq > since` 的消息。

### 帧类型

客户端 → 服务端:

| t | 字段 | 说明 |
| --- | --- | --- |
| `send` | `cid`, `body` | 发送消息, `cid` 由客户端生成用于去重与回执 |
| `ack` | `seq` | 确认已收到并展示到 `seq` |
| `reg` | `pushToken` | 上报厂商推送 token (例如 MiPush regId) |
| `watch` | `subjects` | 当前在看的指标主体, 整体替换, 空表示不看 |
| `offer` | `subjects` | 仅探针: 能提供的主体 |
| `metric` | `subject`, `points`, `history?` | 仅探针: 指标点 |

服务端 → 客户端:

| t | 字段 | 说明 |
| --- | --- | --- |
| `welcome` | `head` | 连接成功, 当前最大 seq |
| `msg` | `seq`, `ts`, `src`, `body`, `cid?` | 一条消息 |
| `sent` | `cid`, `seq`, `ts` | 发送回执 |
| `err` | `code`, `text` | 错误 |
| `probes` | `subjects` | 在线探针的主体, 连上时发一次, 变化时再发 |
| `metric` | `subject`, `points`, `history?` | 转发自探针, 只发给在看的连接 |
| `demand` | `subjects`, `intervalMs` | 仅探针: 需要实时推送的主体 |

指标细节见 `docs/features/metrics.md`。

`body` 目前只有 `{ "kind": "text", "text": "..." }`, 后续微页面组件会扩展为 `{ "kind": "ui", "tree": ... }`。

### HTTP

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/send` | `{ "src": "agent", "body": {...} }`, 返回 `{ seq, ts }`, 等价于 `POST /api/v1/messages` |
| `GET` | `/api/messages?since=0&limit=100` | 拉取历史 |
| `GET` | `/health` | 健康检查 |

HTTP 接口用 `Authorization: Bearer <令牌>` 鉴权。`/api/send` 也接受带 `messages:send` scope 的接入 key。
