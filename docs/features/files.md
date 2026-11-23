# 文件 (R2)

字节放 R2 桶 `hx-aioa-files`, 元数据放 Hub 的库 (`file` 表), 消息里只带引用 `data.file = { id, name, size, mime }`。

## 额度设计

- 字节不经过 Durable Object: 上传和下载都由 Worker 凭票据直接读写 R2, DO 只做登记, 换地址和上传完成回报, 各一次小请求。
- 下载地址 24 小时有效, 响应带 `immutable` 缓存头; 安卓下载过的文件留在本机 (`files/att/<id>/`), 同一个文件每台设备只下一次。自己发的文件上传时就拷进本机, 不再下载。
- 只有不超过 2 MB 的图片会自动下载显示缩略图, 其他文件点了才下。
- 引用计数: 每条带附件的消息 +1, 撤回 / 删除 -1, 降到 0 立即从 R2 删除; 清空群时群里的文件一起删; 传了没发出去的文件每天清理一次。
- 上限: 单个文件 95 MB (Worker 请求体上限 100 MB), 整个部署 8 GB (R2 免费 10 GB)。

## 接口

1. `POST /api/v1/files` `{ name, size, mime?, channel? }` → `{ file: FileRef, upload, expires }`。主人可传任意群 (默认备忘); 成员只能传自己所在的群; Agent 只能传自己的群。
2. `PUT {upload}`, 请求体为文件字节, 必须带 `Content-Length` 且不大于登记的大小。
3. 发消息时带上 `file: <id>`: 长连接 `send` 帧, 或 `POST /api/v1/messages`。文件必须已传完, 且是发送者能读的群里的。只发文件时正文写 `[文件] 名字`。
4. `GET /api/v1/files/{id}/link` → `{ url, expires }`, 能读这个群的人才能换; `GET {url}` 下载, 支持 `Range`。
5. `DELETE /api/v1/files/{id}`: 主人, 上传者或群管理员。`GET /api/v1/files` (主人): 总用量。

命令行: `AIOA_SERVER=.. AIOA_TOKEN=.. node tools/upload.mjs <文件> [群] [说明]`。

## 部署

部署流程会先确保桶存在 (`wrangler r2 bucket create`)。部署 token 没有 R2 编辑权限时去掉绑定照常部署, 文件接口返回 503。

## 以后

- 超过 95 MB 的文件: R2 multipart 分片上传。
- Telegram 作为第二存储渠道 (冷文件 / 备份), 方案见 #45 评论。
