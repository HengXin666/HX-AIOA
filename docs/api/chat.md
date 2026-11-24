# 群聊接口 (v1)

群 = 事件的 `channel`。客户端把同一 channel 的消息显示为一个群, 组 (文件夹) 只在客户端设置 `chatFolders` 里。

## 群资料

- `GET /api/v1/chats` → `{ chats: [ChatMeta] }`, 带 `ETag`, 没变时 304。带 `events:read` 的 key 只看到白名单内的群, 且不含 `agents`。
- `PATCH /api/v1/chats/{channel}` (母号) `{ title, avatar, pinned, muted, read, digest }`; 群不存在时即新建。值为 `null` / 空串 / `false` 表示清除。`read` 只前进。`digest` 为 `daily` / `weekly`, 标记日报 / 周报群。`hideListening` / `hideTyping` 为 true 时不再推 "正在监听" / "正在输入" (群主, 多人群管理员可改), 见 [stream.md](stream.md) 的 `presence`。
- `DELETE /api/v1/chats/{channel}` (母号) 删除群: 消息, 文件, 接入的 Agent (key 作废), 插件安装与工作台, 待办, 多人群成员与邀请全删, 返回 `{ deleted, cleared }`。群资料只留墓碑 `{ channel, cleared, deleted: <时间> }`, 各端据此删本地记录并隐藏; 之后再有消息进来群会重新出现, 再 `PATCH` 同名群即复活为新群。
- `POST /api/v1/chats/{channel}/typing` (群 Agent 的 key) 报 "正在输入"; 人走长连接的 `typing` 帧。`GET /api/v1/chat-agent/me` (群 Agent 的 key) 返回 `{ me: { keyId, name, channel, sourceId, reads } }`。命令行见 [cli.md](../client/cli.md)。
- 变化后向客户端广播 `{ t: "chat_sync", topic: "chats", channel }`。

## 读群消息

`GET /api/v1/chats/{channel}/messages?since=&limit=` → `{ messages: [Envelope], head }`。母号, 或 scope 含 `events:read` 且白名单匹配该群的 key。

## 清空聊天记录

`DELETE /api/v1/chats/{channel}/messages?before=` (母号) → `{ deleted, cleared }`。删掉该群 seq < before 的消息 (不填为全部), 群键规则同客户端: 有 channel 用 channel, 本机发的归 `备忘`, 否则按来源名。群资料记下 `cleared` (只前进) 并广播 `chat_sync`, 各端删掉本地 seq <= cleared 的消息。清空只删消息, 群资料, 成员, Agent 都保留, 群仍在列表里。被清空的消息如果收藏过, 收藏变成 `gone` (只剩摘要)。

## 群里的 Agent

主人只定名字和可读的群, 不写提示词。服务端给一段接入语 (文档链接, 服务地址, 群, 任务, 密钥), 主人整段发给外部 Agent, 它按文档拉取专属指令, 存进长期指令并报到。

- `POST /api/v1/chats/{channel}/agents` `{ name, reads: [channel] }` → `{ agent, prompt, key }`。服务端新建一个来源 (默认频道为本群) 和一把 key (`messages:send`, `events:write`, 有 `reads` 时加 `events:read`, 白名单为本群 + reads)。`prompt` 是一句接入语, 含明文 key, 只在这一次返回。
- `POST .../agents/{keyId}/rotate` → `{ agent, prompt, key }`: 作废旧 key 发新 key, 来源与历史不变, 需要重新报到。插件 Agent 的接入语带插件的定时与任务, 插件记录的 keyId 同步更新。改名不变指令版本, 不用重新报到。
- `PATCH .../agents/{keyId}` `{ name, reads }`: key 不变; 指令内容变了就标 `pending`, 等 Agent 重新拉取报到。
- `GET .../agents/{keyId}/prompt` → 当前下发给它的完整指令 (不含 key)。
- `DELETE .../agents/{keyId}`: 删除来源并作废 key。
- Agent 侧 (用它自己的 key): `GET /api/v1/chat-agent/guide` → Markdown 全文, 响应头 `X-Aioa-Guide-Version` 为版本 (内容哈希); `POST /api/v1/chat-agent/ack` `{ version }` 报到, 版本不是最新返回 409。指令要求它每天首次干活前和遇到 401 / 403 时重新拉取, 版本变了整段替换。
- `ChatAgent.joined` 为最近报到时间, `pending` 为指令变了还没重新报到。旧数据里的 `brief` 不再使用。

## 接入总览

`GET /api/v1/integrations` (母号) → `{ integrations: [Integration] }`, 每把 key 一行:
- `kind`: `push` 单向推送的消息源 (定时任务, 群里接入的 Agent, webhook); `interactive` 可双向交互的 Agent (Codex 等, key 带 `agent` scope, 会注册并接收动作); `probe` 探针; `other`。
- `group` 写入的群, `reads` 额外可读的群, `source` 绑定的来源, `agents` 用这把 key 注册的交互 Agent 及在线状态, `lastActive` 最近一次发消息或心跳。
- 作废: 群里的 Agent 用 `DELETE /chats/{channel}/agents/{keyId}`, 其它用 `DELETE /keys/{id}`。

## 引用与转发 (长连接 send 帧)

`{ t: "send", cid, body: { kind: "text", text }, reply?: seq, fwd?: seq, channel?: 群 }`

- `reply`: 新消息带 `reply: { seq, id, src, text }` 快照 (摘要 200 字)。
- `fwd`: 正文取原消息全文, 带 `fwd: { src, ts, channel? }`。
- `channel`: 发到哪个群, 不写为备忘。

## 收藏

- `GET /api/v1/favorites` → `{ favorites: [{ seq, saved, ev, gone? }] }`, 带 `ETag`。收藏按引用存 (原消息 id + 一句摘要), 读取时取原消息的当前版本, HTML, 附件, 转发都和聊天里一致; 原消息被清空等找不到时 `gone: true`, `ev` 只剩摘要。原消息被撤回或删除时收藏一并移除。
- `PUT /api/v1/favorites/{seq}` / `DELETE /api/v1/favorites/{seq}`; 变化后广播 `{ t: "chat_sync", topic: "favorites" }`。

## 头像

- `PUT /api/v1/avatars` (母号, body 为图片, ≤64KB) → `{ id }` (内容哈希)。
- `GET /api/v1/avatars/{id}` → 图片, `Cache-Control: immutable`, 客户端按 id 永久缓存。
- 群头像写进群资料 `avatar`; 本人头像写进设置 `avatar`。

## 其它

- `GET /api/v1/events/seq/{seq}` → 单条消息, 用于跳转到本地没有的被引用消息。

## HTML 卡片

周报, 日报这类想自己定样式的内容可以带 HTML:

- 消息: `POST /api/v1/messages {text, html}`, `text` 仍必填 (通知, 列表摘要, 旧客户端用它)。
- 事件 / 报告: `data.html`。
- 上限 64KB。App 在沙箱 WebView 里渲染: 不执行脚本, 不联网 (样式写内联 `<style>`, 图片用 `data:`), 链接交给浏览器打开。聊天里内联显示 (最高 420dp, 可全屏), 总览点开整页显示。
