# 群聊接口 (v1)

群 = 事件的 `channel`。客户端把同一 channel 的消息显示为一个群, 组 (文件夹) 只在客户端设置 `chatFolders` 里。

## 群资料

- `GET /api/v1/chats` → `{ chats: [ChatMeta] }`, 带 `ETag`, 没变时 304。带 `events:read` 的 key 只看到白名单内的群, 且不含 `agents`。ETag 由群资料版本号 (任何一行群资料写入 +1, 存在行里) 与本人已读算出, 304 时不读全表; Agent 活跃时间不进 ETag (靠 `agent_active` 帧更新)。别人之间的单聊不出现在主人的列表里。
- `PATCH /api/v1/chats/{channel}` (母号) `{ title, avatar, notice, pinned, muted, read, digest }`; 群不存在时即新建。值为 `null` / 空串 / `false` 表示清除。`notice` 为群公告, 最多 500 字 (群主与管理员可改)。返回 `{ chat }` (本人视图)。
- 已读 (#129): `read` 只前进, 存在每人每群一行的已读表里, 不改群资料也不改 `updated`, 不触发 `chat_sync`; 只给本人的设备推 `{ t: "chat_read", channel, read }`。主人与子号都一样, 旧数据 (群资料里的 `read`, 成员表里的 `read`) 读取时取较大者。`digest` 为 `daily` / `weekly`, 标记日报 / 周报群。`hideListening` / `hideTyping` 为 true 时不再推 "正在监听" / "正在输入" (群主, 多人群管理员可改), 见 [stream.md](stream.md) 的 `presence`。
- `DELETE /api/v1/chats/{channel}` (母号) 删除群: 消息, 文件, 接入的 Agent (key 作废), 插件安装与工作台, 待办, 多人群成员与邀请全删, 返回 `{ deleted, cleared }`。群资料只留墓碑 `{ channel, cleared, deleted: <时间> }`, 各端据此删本地记录并隐藏; 之后再有消息进来群会重新出现, 再 `PATCH` 同名群即复活为新群。
- `POST /api/v1/chats/{channel}/typing` (群 Agent 的 key) 报 "正在输入"; 人走长连接的 `typing` 帧。`GET /api/v1/chat-agent/me` (群 Agent 的 key) 返回 `{ me: { keyId, name, channel, sourceId, reads } }`。命令行见 [cli.md](../client/cli.md)。
- 群资料变化后推 `{ t: "chat_sync", topic: "chats", channel, chat }`, `chat` 是收帧人视图下的整份资料 (主人含 Agent, 子号是成员视图), 客户端直接替换, 不必重拉 `/chats`。只发给该群成员与主人; 只改了主人私有字段 (置顶, 免打扰, 日报, Agent) 时只发主人; 子号改自己的置顶 / 免打扰只发他自己。被移出群或群被删时, 相关的人收到不带 `chat` 的帧, 应重拉列表。
- Agent 活跃 (#129): 内存记录, 同一个 Agent 每 2 分钟最多推一帧 `{ t: "agent_active", channel, keyId, active }` 给主人; 库里的值比现在早 30 分钟以上才写一次, 每 30 分钟的 cron 再把内存里较新的落库。`GET /chats` 里主人视图的 `agents[].active` 已合并内存值。

## 单聊 (#133)

- `POST /api/v1/dms` `{ peer: "<账号 id>" }` (主人或子号) → `{ chat }`。群名为 `dm:<字典序小的 uid>:<大的 uid>` (主人用自己的账号 id), 已有就直接返回, 不重复写。`peer` 必须是已存在且启用的账号, 不能是自己 (400)。
- 单聊里两人都是普通成员: `ChatMeta.kind = "dm"`, `peer` 为对方 uid (按看的人算), `role` 为 `member`, `members` 为 2; 没起名时 `title` 用对方昵称。
- 单聊不能接 Agent, 邀请, 加人, 设管理员, 踢人, 也不能改标题 / 头像 / 公告 / 提示开关, 一律 400 `单聊不能...`; 置顶, 免打扰, 已读照常。
- 主人不是一方的单聊: 主人的群列表, `chat_sync` 与消息推送里都没有。

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
- Agent 侧 (用它自己的 key): `GET /api/v1/chat-agent/guide` → Markdown 全文, 响应头 `X-Aioa-Guide-Version` 为版本 (内容哈希); `POST /api/v1/chat-agent/ack` `{ version }` 报到, 版本不是最新返回 409。指令要求它每天首次干活前和遇到 401 / 403 时重新拉取, 版本变了整段替换。主人改了设置后服务端当场检查所有已报到的 Agent, 版本变了就在群里发系统通知, 并给它在线的长连推 `guide` 帧 (hxaioa watch 退出码 3), 不用等 Agent 下次请求。
- 拉群消息加 `slim=1` (`GET /api/v1/chats/{c}/messages?since=..&slim=1`): `data.html` 去掉, 换成 `htmlBytes` 长度, 省流量 (`hxaioa history` 用它)。
- Agent 长期记忆: `GET /api/v1/chat-agent/memory` → `{ text, updated }`; `PUT` `{ text }` 整段覆盖 (最多 4000 字, 空串清空)。按 Agent 来源存, 轮换密钥不丢, 只有这把 key 自己能读写 (`hxaioa memory`)。
- `ChatAgent.joined` 为最近报到时间, `pending` 为指令变了还没重新报到。旧数据里的 `brief` 不再使用。

## 接入总览

`GET /api/v1/integrations` (母号) → `{ integrations: [Integration] }`, 每把 key 一行:
- `kind`: `push` 单向推送的消息源 (定时任务, 群里接入的 Agent, webhook); `interactive` 可双向交互的 Agent (Codex 等, key 带 `agent` scope, 会注册并接收动作); `probe` 探针; `other`。
- `group` 写入的群, `reads` 额外可读的群, `source` 绑定的来源, `agents` 用这把 key 注册的交互 Agent 及在线状态, `lastActive` 最近一次发消息或心跳。
- 作废: 群里的 Agent 用 `DELETE /chats/{channel}/agents/{keyId}`, 其它用 `DELETE /keys/{id}`。

## 引用, 转发, @ 与合并转发 (长连接 send 帧)

`{ t: "send", cid, body: { kind: "text", text }, reply?: seq, fwd?: seq, channel?: 群, file?: 文件 id, mentions?: [..], bundle?: { from, seqs } }`

- `reply`: 新消息带 `reply: { seq, id, src, text }` 快照 (摘要 200 字)。
- `fwd`: 正文取原消息全文, 带 `fwd: { src, ts, channel? }`。
- `channel`: 发到哪个群, 不写为备忘。
- 子号只能引用, 转发, 合并自己所在群的消息, 看不到的当不存在。
- `mentions` (#131): 被 @ 的, 元素为账号 id, `agent:<keyId>` 或 `all`, 去重后最多 50 个, 原样存进消息 `Envelope.mentions`。客户端 (安卓 `:link`) 收到 `ev` 时看 `mentions` 里有没有自己的 uid 或 `all`, 有就即使群免打扰也提醒。云 Agent 的 `GET /api/v1/chat-agent/next` 里, `mentions` 含 `agent:<它的 keyId>` 或 `all` 的条目带 `mentioned: true`。
- `bundle` (#132): 合并转发, `seqs` 最多 100 条。服务端生成新消息, 正文 `[聊天记录] <from>`, `data.bundle = { from, count, refs: [seq], head: [{ src, text }] }`: `refs` 按 seq 升序, 已撤回 / 删除 / 看不到的不算; `head` 为前 4 条, `text` 截 60 字。一条都没有时返回 err。
- 详情: `GET /api/v1/events/seq?seqs=1,2,3` (最多 100 个) → `{ events: [Envelope] }`, 按 seq 升序。主人都能取; 子号与 `events:read` 的 key 只返回自己能读的群里的; 撤回 / 删除 / 不存在的不出现在结果里。
- 详情带 `via=<卡片 seq>`: 能读到这张卡片的人, 就能取它 `data.bundle.refs` 里的消息, 不管原消息在哪个群 (像 QQ 的聊天记录)。不在 refs 里的 seq 仍按上面的规则。卡片里套的卡片用 `via=<外层>,<内层>` (最多 2 层): 第一张自己要能读, 后面每张都要在上一张的 refs 里, 返回最后一张的 refs。via 格式不对 400, via 不是能读到的卡片 (被撤回, 不是合并转发, 读不到, 不在上一层 refs 里) 403。安卓的聊天记录详情只展开一层, 请求带 `via=<卡片 seq>`。

## 收藏

- `GET /api/v1/favorites` → `{ favorites: [{ seq, saved, ev, gone? }] }`, 带 `ETag`。收藏按引用存 (原消息 id + 一句摘要), 读取时取原消息的当前版本, HTML, 附件, 转发都和聊天里一致; 原消息被清空等找不到时 `gone: true`, `ev` 只剩摘要。原消息被撤回或删除时收藏一并移除。
- `PUT /api/v1/favorites/{seq}` / `DELETE /api/v1/favorites/{seq}`; 变化后广播 `{ t: "chat_sync", topic: "favorites" }`。

## 头像

- `PUT /api/v1/avatars` (主人或子号, body 为图片, ≤64KB) → `{ id }` (内容哈希)。
- 本人头像 (#130): `PATCH /api/v1/me` `{ display?, avatar?: "<头像 id>" | null }` → `{ user }`, 存在账号资料 `UserPublic.avatar`, 只在改的时候写一次; 改了昵称或头像, 他所在群的资料版本 +1, 成员列表与群列表的 ETag 随之失效。
- `GET /api/v1/avatars/{id}` → 图片, `Cache-Control: immutable`, 客户端按 id 永久缓存。
- 系统发送者 (#123 #128): 服务端自己发言用的来源 (`system`, `system:*`, `终端`) 第一次发言时自动登记。`GET /api/v1/senders` → `{ senders: [{ sid, name, icon, alias, avatar, first, last, updated }] }` (第一次请求时补登历史消息里的); `PATCH` (或 `PUT`) `/api/v1/senders/{sid}` (母号) `{ "alias": "名字" | null, "avatar": "<头像 id>" | null }`, 没登记的 404, 改了推 `chat_sync` topic `senders`。改了名的新消息 `source.name` 直接是别名; 客户端旧消息也按别名显示, 没设头像的用内置图标。安卓入口: 我的 → 管理 → 系统发送者。
- 没有所属群的系统通知 (CF 额度, GitHub 授权到期) 发进 `system` 群 ("系统通知"), 发送者按用途命名 (指令更新, GitHub 同步, GitHub 授权, 待办提醒, CF 额度)。
- 群头像写进群资料 `avatar`; 本人头像写进账号资料 `avatar` (旧版写在设置 `avatar`)。

## 群成员 (#130)

- `GET /api/v1/chats/{channel}/members?cursor=&limit=&q=` (群里任何人) → `{ members: [RoomMember], next? }`。`RoomMember`: `{ id, name, display, role, joined, avatar? }`。
- 按 (joined, id) 翻页, 默认 50 条, 最多 200; `next` 是下一页的 `cursor`, 没有下一页时不给。群主 (主人) 只在第一页最前面; 别人之间的单聊不列主人。`q` 按用户名与昵称过滤 (不分大小写)。
- 带 `ETag` (成员数 + 该群资料版本), 没变时 304; 有人进出群, 改身份, 改昵称 / 头像都会让它变。
- 群主 (主人) 没有入群时间, `joined` 为 0。
- 在线状态: `GET /api/v1/chats/{channel}/presence` (群里任何人与主人) → `{ online: [uid], seen: { uid: 时间 } }`。`online` 为现在有前台长连接的人 (安卓后台常驻连接不算), 主人记成主人的账号 id; `seen` 为最近在线时间, 取本进程里前台连接最近断开的时间与账号设备会话 `seen` (刷新令牌时更新) 的较大者, 读不到的不给。只读内存与会话表, 不落库, 不带 ETag; 客户端打开成员页 / 资料卡时请求一次, 不轮询。
- 推送按账号给在线连接分组 (只在连上 / 断开时重建), 一条消息只查本群成员的连接, 不再逐个解析全部连接。

## 其它

- `GET /api/v1/events/seq/{seq}` → 单条消息, 用于跳转到本地没有的被引用消息。批量见上面的合并转发。

## HTML 卡片

周报, 日报这类想自己定样式的内容可以带 HTML:

- 消息: `POST /api/v1/messages {text, html}`, `text` 仍必填 (通知, 列表摘要, 旧客户端用它)。
- 事件 / 报告: `data.html`。
- 上限 64KB。App 在沙箱 WebView 里渲染: 不执行脚本, 不联网 (样式写内联 `<style>`, 图片用 `data:`), 链接交给浏览器打开。聊天里内联显示 (最高 420dp, 可全屏), 总览点开整页显示。
