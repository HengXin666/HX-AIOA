# 文件 (R2 / HX-CF-Drive)

字节放 R2 桶 `hx-aioa-files` 或 [HX-CF-Drive](https://github.com/HengXin666/HX-CF-Drive) (字节存 TG 私有频道), 元数据放 Hub 的库 (`file` 表), 消息里只带引用 `data.file = { id, name, size, mime }`。头像, 群图标等 DO 里的数据不走这里, 也不受存储路由影响。

## 存储路由 (#88)

主人在设置里统一配置 (`PATCH /api/v1/settings` 的 `storage` 键, 可以只给要改的键, 传 `null` 恢复默认):

| 键 | 取值 | 默认 | 含义 |
| --- | --- | --- | --- |
| `small` | `r2` / `cfd` | `r2` | 不超过阈值的文件 |
| `large` | `r2` / `cfd` / `off` | `r2` | 超过阈值的文件; `off` 拒收 (413) |
| `threshold` | 1 MB 到 95 MB (字节) | 20 MB | |
| `onFull` | `reject` / `cfd` | `reject` | R2 到 8 GB 上限时拒收 (507), 或新文件改走 Drive |
| `direct` | 布尔 | `false` | 主人设备直连 TG 拉取 |
| `coldDays` | 0 到 3650 | 0 | 大于 0 时每天把这么多天没下载过的 R2 文件搬到 Drive (冷迁移) |

- 默认与接入 Drive 之前一样全走 R2。选了服务端没绑定的后端, 保存时直接 400, 上传时不会悄悄换后端。
- 每个文件记自己的后端 (`store`) 和 Drive 节点 id (`ext`)。改路由只影响之后上传的文件, 老文件留在原后端, 换地址时按文件自己的后端解析, 已发的消息和安卓本机缓存都不受影响。
- cfd 文件: 上传票据带 `b=cfd` (签进票据, 改不了), Worker 把字节流式转给 Drive; `link` 返回 Drive 的签名直链 (24 小时, 绑定 AIOA 的令牌, 服务端缓存 12 小时), 字节不经过 AIOA; 删除时当场在 Drive 彻底删 (TG 消息一起删), Drive 删失败的行保留成不可用, 由每天的清理重试。
- 接入 Drive 需要三项: Service Binding `DRIVE -> hx-cf-drive`, 变量 `CFD_ORIGIN` (Drive 公网地址), 密钥 `CFD_TOKEN` (Drive 后台建的受限令牌, 根目录 `/aioa`, read+write)。缺一项就当没接入, 不经公网退回。
- 迁移任务 (主人): `POST /api/v1/files/migrate { to: "r2" | "cfd" }` 开始, `GET` 看进度, `DELETE` 停止。一次只有一个任务, 状态存在 Hub 里, 由闹钟每 10 秒搬 3 个 (DO 重启后接着跑)。每个文件先写新后端, 再一次 UPDATE 改 `store` / `ext`, 最后删旧字节; 文件 id 不变, 已发的消息不用改。搬回 R2 只搬 95 MB 以内的 (大的计入 skipped), R2 满了就停。失败的文件记下不再重试, 超过 200 个就停。旧地址随之失效, 安卓遇到 403 / 404 / 410 会换一次地址。
- 冷迁移: 每天 03:00 (UTC+8) 的清理任务里, `coldDays` 大于 0 且没有任务在跑时, 开一轮只搬冷文件的迁移。"最近下载" 按换下载地址的时间算, 一天最多写一次。
- TG 直连 (主人设备): 安卓 "存储" 页存 Bot 令牌 (只在本机, Android Keystore 加密) 并打开 `direct`。下载 Drive 上的文件时 `GET /files/{id}/link?direct=1`, 服务端校验是主人且开了 `direct` 后向 Drive 要分片清单 (`/api/v1/fs/manifest`, Drive v0.3.1), 返回 `direct: { size, chunkSize, chunks: [{ bot, fileId, size }] }`。手机按 bot 对上令牌, `getFile` 后从 TG 3 片并发下载, 按偏移写入, 完成的片记在本地, 中断后只补缺的片; 走 App 的代理。只有某片的 Bot 令牌手机上没有, 或 TG 说 file_id 无效时, 这一片用 `url` 加 Range 从 Drive 取; 其他错误直接报错。上传不走直连。
- 撤销 Drive 令牌前先把文件迁回 R2: 令牌吊销后 Drive 直链 60 秒内失效。
- `GET /api/v1/files` (主人) 返回分后端用量 `byStore`, 各后端是否就绪 `ready`, 当前路由 `storage`。R2 的 8 GB 上限只算 R2 里的字节。

## 额度设计

- 字节不经过 Durable Object: 上传和下载都由 Worker 凭票据直接读写 R2, DO 只做登记, 换地址和上传完成回报, 各一次小请求。
- 下载地址 24 小时有效, 响应带 `immutable` 缓存头; 安卓下载过的文件留在本机 (`files/att/<id>/`), 同一个文件每台设备只下一次。自己发的文件上传时就拷进本机, 不再下载。
- 只有不超过 2 MB 的图片会自动下载显示缩略图, 其他文件点了才下。
- 安卓下载: 没下完的 `.part` 留着, 下次带 `Range` 接着下; 一次响应没给全时继续按 `Range` 拉剩下的; 地址返回 403 / 404 / 410 (过期, 文件换了后端) 时重新换一次地址, 只重试一次。
- 引用计数: 每条带附件的消息 +1, 撤回 / 删除 -1, 降到 0 立即从 R2 删除; 清空群时群里的文件一起删; 传了没发出去的文件每天清理一次。
- 安全: 文件和 API 同源, 下载响应带 `nosniff` 与 `Content-Security-Policy: sandbox` (PDF 除外), 上传的 html / svg 打开后脚本不执行; 上传时的 Content-Type 只收合法的 `type/subtype`。
- 上限: 走 R2 的单个文件 95 MB (Worker 请求体上限 100 MB); 超过的只能走 Drive, 分片上传, 单个文件 4 GB; R2 总量 8 GB (R2 免费 10 GB), Drive 不设总量上限。

## 接口

1. `POST /api/v1/files` `{ name, size, mime?, channel? }` → `{ file: FileRef, upload, expires }`。主人可传任意群 (默认备忘); 成员只能传自己所在的群; Agent 只能传自己的群。
2. `PUT {upload}`, 请求体为文件字节, 必须带 `Content-Length` 且不大于登记的大小。
   超过 95 MB 时登记结果多一个 `chunks: { size, count }`: 第 i 片 (从 0 开始) `PUT {upload}&i=<i>`, 回 `{ receipt }`; 全部传完后 `POST /api/v1/files/{id}/commit { receipts }` (按序号排好, 上传者或主人)。分片票据 24 小时有效, 里面带着 Drive 的上传票据, Worker 收到分片直接转给 Drive, 不唤醒 DO。安卓每片最多试 3 次, 429 / 503 按 `Retry-After` 等; 分片上传的大文件不拷进本机缓存。
3. 发消息时带上 `file: <id>`: 长连接 `send` 帧, 或 `POST /api/v1/messages`。文件必须已传完, 且是发送者能读的群里的。只发文件时正文写 `[文件] 名字`。
4. `GET /api/v1/files/{id}/link` → `{ url, expires }`, 能读这个群的人才能换; `GET {url}` 下载, 支持 `Range`。
5. `DELETE /api/v1/files/{id}`: 主人, 上传者或群管理员。`GET /api/v1/files` (主人): 总用量。

命令行: `AIOA_SERVER=.. AIOA_TOKEN=.. node tools/upload.mjs <文件> [群] [说明]`。

## 部署

部署流程会先确保桶存在 (`wrangler r2 bucket create`)。部署 token 没有 R2 编辑权限时去掉绑定照常部署, R2 不可用。仓库 secret `CFD_TOKEN` 配了才同步到 Worker; 两个后端都没有时文件接口返回 503。

本机联调: Drive 仓库里起 `mock-tg` 与 `wrangler dev`, 再在 `server/` 起 `wrangler dev --var CFD_TOKEN:<受限令牌> --var CFD_ORIGIN:<Drive 本机地址>`, 两个 dev 进程会自动连上 Service Binding, 然后跑 `node tools/e2e-drive.mjs` (36 项, 含 96 MB 分片上传, 迁移任务与 TG 直连清单)。

