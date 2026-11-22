# 群聊接口 (v1)

群 = 事件的 `channel`。客户端把同一 channel 的消息显示为一个群, 组 (文件夹) 只在客户端设置 `chatFolders` 里。

## 群资料

- `GET /api/v1/chats` → `{ chats: [ChatMeta] }`, 带 `ETag`, 没变时 304。带 `events:read` 的 key 只看到白名单内的群, 且不含 `agents`。
- `PATCH /api/v1/chats/{channel}` (母号) `{ title, avatar, pinned, muted, read, digest }`; 群不存在时即新建。值为 `null` / 空串 / `false` 表示清除。`read` 只前进。`digest` 为 `daily` / `weekly`, 标记日报 / 周报群。
- 变化后向客户端广播 `{ t: "chat_sync", topic: "chats", channel }`。

## 读群消息

`GET /api/v1/chats/{channel}/messages?since=&limit=` → `{ messages: [Envelope], head }`。母号, 或 scope 含 `events:read` 且白名单匹配该群的 key。

## 群里的 Agent

- `POST /api/v1/chats/{channel}/agents` `{ name, brief, reads: [channel] }` → `{ agent, prompt }`。服务端新建一个来源 (默认频道为本群) 和一把 key (`messages:send`, `events:write`, 有 `reads` 时加 `events:read`, 白名单为本群 + reads)。`prompt` 是完整的接入提示词, 含明文 key, 只在这一次返回。
- `POST .../agents/{keyId}/rotate` → `{ agent, prompt }`: 作废旧 key 发新 key, 来源与历史不变。Agent 挂了或 key 泄露时用。
- `PATCH .../agents/{keyId}` `{ name, brief, reads }`: 改使唤提示词或可读的群, key 不变。
- `GET .../agents/{keyId}/prompt` → 不含 key 的提示词 (保存的使唤方式)。
- `DELETE .../agents/{keyId}`: 删除来源并作废 key。

## 引用与转发 (长连接 send 帧)

`{ t: "send", cid, body: { kind: "text", text }, reply?: seq, fwd?: seq, channel?: 群 }`

- `reply`: 新消息带 `reply: { seq, id, src, text }` 快照 (摘要 200 字)。
- `fwd`: 正文取原消息全文, 带 `fwd: { src, ts, channel? }`。
- `channel`: 发到哪个群, 不写为备忘。

## 收藏

- `GET /api/v1/favorites` → `{ favorites: [{ seq, saved, ev }] }`, 带 `ETag`。收藏存的是消息快照。
- `PUT /api/v1/favorites/{seq}` / `DELETE /api/v1/favorites/{seq}`; 变化后广播 `{ t: "chat_sync", topic: "favorites" }`。

## 头像

- `PUT /api/v1/avatars` (母号, body 为图片, ≤64KB) → `{ id }` (内容哈希)。
- `GET /api/v1/avatars/{id}` → 图片, `Cache-Control: immutable`, 客户端按 id 永久缓存。
- 群头像写进群资料 `avatar`; 本人头像写进设置 `avatar`。

## 其它

- `GET /api/v1/events/seq/{seq}` → 单条消息, 用于跳转到本地没有的被引用消息。
