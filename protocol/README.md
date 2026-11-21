# 消息协议 v1

传输: WebSocket 文本帧, 内容为 JSON。心跳单独使用纯文本 `ping` / `pong`, 由服务端自动应答, 不计入业务帧。

## 连接

```
wss://<域名>/ws?token=<令牌>&device=<设备 id>&since=<已收到的最大 seq>
```

- `device`: 设备唯一 id。以 `android` 开头的设备视为手机, 参与兜底推送判断。
- `since`: 可选, 服务端会先补发 `seq > since` 的消息。

## 帧类型

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

指标细节见 `docs/metrics.md`。

`body` 目前只有 `{ "kind": "text", "text": "..." }`, 后续微页面组件会扩展为 `{ "kind": "ui", "tree": ... }`。

## HTTP

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/send` | `{ "src": "agent", "body": {...} }`, 返回 `{ seq, ts }` |
| `GET` | `/api/messages?since=0&limit=100` | 拉取历史 |
| `GET` | `/health` | 健康检查 |

HTTP 接口用 `Authorization: Bearer <令牌>` 鉴权。
