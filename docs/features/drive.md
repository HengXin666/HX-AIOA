# 网盘 (HX-CF-Drive, #154)

把 [HX-CF-Drive](https://github.com/HengXin666/HX-CF-Drive) 当网盘接进 App: 浏览, 上传, 预览, 保存到手机, 整理, 回收站, 分享。网盘是 Drive 里一个独立根目录的视图 (#158), AIOA 不复制元数据, 不写自己的库。聊天附件仍按 [files.md](files.md) 的存储路由走, 两者共用同一个 Drive 但互不可见。

## 0. 目录规范 (#158)

| Drive 里的位置 (令牌根 `/aioa` 时) | 令牌根 `/` 时 | 是什么 | 网盘里 |
| --- | --- | --- | --- |
| `/aioa/drive` | `/drive` | 网盘根, 首次使用自动创建 | 显示为 `/` |
| `/aioa/drive/聊天文件` | `/drive/聊天文件` | 聊天里 "存到网盘" 的默认目录 | `/聊天文件` |
| `/aioa/YYYY-MM` | `/aioa/YYYY-MM` | 聊天附件 (files.md) | 看不到 |
| 网盘根以外的其他目录 | 同左 | 邮件附件等系统目录, 主人自己的其他文件 | 看不到 |

- 网盘根 = 令牌根 + `/drive` (`DRIVE_ROOT_DIR`)。客户端只看到网盘内的相对路径, 根是 `/`; 换算只在服务端做。
- 隔离靠 Drive 的 `X-Drive-Scope: /drive` 请求头 (Drive #18): 网盘接口的每个 Drive 请求都带它, Drive 把这次请求的根收窄到网盘根, 路径, 列目录, 搜索, 回收站 (含清空), 分享列表与按 id 的操作 (移动, 复制, 删除, 直链, 清单, 分享, 恢复, 彻底删除) 都按它隔离; 网盘根外的 id Drive 回 403, AIOA 对外统一 404, 路径参数带 `..` 等 400。服务端每个 isolate 每 10 分钟确认一次 Drive 认得这个头 (`/fs/stat?path=/` 返回的路径应等于网盘根), 旧版 Drive 不认时网盘接口一律 503 `drive_outdated`, 不会退化成能看到附件。
- 只有两处用令牌根视角 (不带这个头): "存到网盘" 把附件节点复制进网盘根; "发到群" 把网盘文件复制进附件月目录。两者都先在网盘视角确认源在网盘里。
- 迁移: 换通行证 (`pass`) 时服务端把旧位置的东西一次性 move 进网盘根 (Drive move, 不复制字节), 同名文件夹合并, 同名文件加时间后缀, 移空的旧文件夹进回收站; 迁走的不会再出现在旧位置, 再跑只多几次 list, 幂等。每次最多 40 个 Drive 请求, 没迁完的下次接着迁; 结果在 `pass` 返回的 `migrated` 里。旧位置: 令牌根是 `/aioa` (或别处) 时, 令牌根下除附件月目录与 `drive` 外的全部条目; 令牌根是 `/` 时, 只迁 `/聊天文件` 与 `/aioa` 下除月目录外的条目 (`/aioa/drive` 合并进来), Drive 根下其他东西可能是主人自己的文件, 不动。

## 1. 通道与鉴权

```
安卓 --(1 小时网盘通行证)--> AIOA Worker /api/v1/drive/* --Service Binding--> Drive REST
安卓 --(访问令牌, 每小时最多 1 次)--> AIOA Worker --> 主 Hub DO  POST /api/v1/drive/pass
安卓 --(Drive 签名直链 / TG 直连)--> Drive 公网 / TG     下载字节
```

- 只有主人能用。主人身份记在主 Hub 的账号目录里, Worker 单独认不出访问令牌是不是主人, 所以先到 DO 换一张 **网盘通行证** (`POST /api/v1/drive/pass`, 要 owner), 之后的网盘请求都由 Worker 验通行证, 不进 DO。
- 通行证: `dp1.<用户>.<到期毫秒>.<签名>`, HMAC (TOKEN_SECRET, 没有时 AUTH_TOKEN), 有效 1 小时, 放在请求头 `X-Aioa-Drive`。也接受 `Authorization: Bearer <AUTH_TOKEN>` (脚本)。
- 代价: 吊销会话后通行证最多还能用 1 小时 (与文件下载票据同类)。只对主人签发, 可以接受。
- 令牌 (#157): 默认直接复用聊天附件已接入的 `CFD_TOKEN`, **不需要新建令牌**。网盘能看到哪里以这个令牌在 Drive 里的根目录为准, 服务端每个 isolate 问一次 (`/fs/stat?path=/`, 缓存 10 分钟):
  - 根是 `/aioa` (按 files.md 建的令牌): 网盘根是 `/aioa/drive`。
  - 根是 `/` (在 Drive 后台改的, 或另配的可选密钥 `CFD_DRIVE_TOKEN`, read + write, 要用量再加 stats): 网盘根是 `/drive`; 聊天附件自动改写到 `/aioa/YYYY-MM/` (见 files.md)。最多 10 分钟后生效 (isolate 缓存)。
  - `DRIVE` 绑定与 `CFD_ORIGIN` 缺一项时网盘接口返回 503。
- 附件目录不在网盘根里, 网盘接口既看不到也写不了 (见 §0), 不再需要单独的只读判断。

## 2. 接口 (Worker, 都要通行证)

前缀 `/api/v1/drive`。路径参数一律先规范化: 必须以 `/` 开头, 去掉重复的 `/`, 拒绝 `.` `..` 段, 反斜杠与控制字符, 最长 1024; 节点 id 只收 `[A-Za-z0-9_-]{1,64}`; 名字不能含 `/`, 不能是 `.` `..`, 最长 255。

| 方法 | 路径 | 转给 Drive | 说明 |
| --- | --- | --- | --- |
| GET | `/list?path=` | `/fs/list` | 返回 `{ path, items }`; 带弱 ETag, `If-None-Match` 命中回 304 |
| GET | `/search?q=` | `/fs/search` | 只搜网盘根内, 返回网盘内路径; Drive 按令牌限 6 次/分钟, App 只在提交时搜 |
| POST | `/mkdir {path}` | `/fs/mkdir` | |
| POST | `/move {id, toPath?, name?}` | `/fs/move` | 改名 = 只给 name |
| POST | `/copy {id, toPath, name?}` | `/fs/copy` | 只复制元数据 |
| POST | `/delete {id}` | `/fs/delete` | 进回收站 |
| GET | `/trash` | `/fs/trash` | |
| POST | `/restore {id}` `/purge {id}` `/trash/empty` | 同名 | |
| POST | `/link {id}` | `/fs/link` | 签名直链, 6 小时 |
| GET | `/manifest?id=` | `/fs/manifest` | TG 直连清单 (见 files.md) |
| POST | `/uploads {path, name, size, mime, sha256?}` | `/uploads` | 秒传成功直接回 `{ done, node }`; Drive v0.4 起多回 `direct` (公网分片地址, 由 Drive 的 `chunkUrl` 改名) |
| PUT | `/chunk?ticket=&i=` | `/uploads/chunk` | 片字节流式转发, 不唤醒 DO |
| POST | `/fold` `/commit` | 同名 | 超过 256 片时 App 每凑齐一组就 fold, commit 交聚合回执 (#157) |
| GET/POST | `/shares` | `/shares` | 列表补上 `url`; 新建可带 `expiresIn` (秒) 与 `password` |
| DELETE | `/shares/{id}` | `/shares/{id}` | 撤销 |
| GET | `/stats` | `/admin/stats` | 令牌没有 stats 权限时回 `{ stats: null }` |

主 Hub (访问令牌, 只主人):

- `POST /api/v1/drive/pass` → `{ pass, expires, root, whole, migrated }`, root 为网盘根在 Drive 里的绝对路径, migrated 为这次迁进网盘根的条目数。没接入回 503。
- `POST /api/v1/drive/save { file, path? }`: 聊天文件存到网盘。文件在 Drive 上时用 Drive 的复制 (只加引用, 0 字节); 在 R2 上或令牌看不到时回 409 `need_upload`, App 改为用本机副本 (没有就先下载) 走分片上传。默认存到网盘内的 `/聊天文件`。
- `POST /api/v1/drive/attach { id, channel? }`: 网盘文件发到群。把节点复制进附件目录, 登记成一个已传完的 cfd 文件, 回 `{ file: FileRef }`; App 再用 `POST /api/v1/messages { file }` 发出。复制不了 (根目录不含附件目录) 时回 409, App 下载后走普通上传。

## 3. 字节不经 AIOA 的程度

- 下载与预览: Drive 签名直链, 字节走 Drive 公网 (或 TG 直连), 不经 AIOA。直链 6 小时, App 按节点缓存地址, 过期 (403 / 410) 自动换链。
- 上传 (#157): 优先手机直传 Drive 公网。Drive v0.4 起分片接口不带 Authorization 时只凭票据 (HMAC 签名, 24 小时, 签发令牌被吊销后最多 60 秒作废, 见 Drive 的 INTEGRATION.md "只凭票据直传"), `/uploads` 返回公网分片地址; AIOA 把它作为 `direct` 交给 App, App 直接 `PUT <direct>?ticket=&i=`, 不带任何凭证, 字节不经 AIOA, 每片只有 1 次 Drive 请求。申请, fold, commit 仍经 AIOA (要令牌)。
- 退回转发: Drive 是旧版 (`/uploads` 没有地址) 就没有 `direct`, App 走 `/drive/chunk` 经 Worker 转发 (每片 1 次 Worker + 1 次 Drive, 不进 DO)。直传时网络不通或公网地址被拦 (401 / 403 / 404 / 405 / 413 等) 时, 这次上传剩下的片自动改走转发; 片本身的错误 (400, 429, 5xx) 照常重试或报错。
- 大文件: Drive 片大小约 19 MiB, 10 GB 约 540 片。App 每凑齐 256 片就 `fold` 成一个聚合回执 (存本机, 丢掉这组的零散回执), commit 只交 3 个聚合回执; fold 失败的组提交时交零散回执。每片从文件对应偏移直接定位读取 (拿得到文件描述符时不从头 skip), 64 KB 缓冲流式写出, 不把整片或整文件读进内存; 断点续传状态 (票据, 回执, 聚合回执, 直传地址) 每片写一次本机。

## 4. 请求量

- 一次进入网盘: 先显示本机缓存, 再 1 次 `list` (Worker + Drive 各 1, Drive D1 读约 子项数 行), 没变回 304。不轮询, 只在进入目录, 下拉刷新, 自己改动之后刷新。
- 通行证: 用网盘的那 1 小时里 1 次 DO 请求, 不用不发。
- 写操作: Worker 1 + Drive 1 到 2 (按 id 的写多问一次路径)。
- 主 Hub DO 只在 `pass`, `save`, `attach` 时被唤醒, 都是用户点了才有。

## 5. App

- 入口: 内置空间 "网盘" (`#drive`), 按 home-spaces 规则默认不置顶 (不参与自动补空位), 在 "更多空间" 与标题下的空间切换里; 侧栏有 "网盘" 链接。网盘可用 (问过一次 `pass`) 才出现, 结果记在本机。
- 浏览: 面包屑, 列表 / 网格, 按名字 / 大小 / 时间排序 (文件夹在前), 搜索, 下拉刷新; 目录列表按路径缓存在本机, 先显示缓存再刷新。
- 文件操作 (长按或行尾菜单): 预览, 保存到手机, 用其他应用打开, 分享, 发到群, 改名, 移动 (选目录), 删除 (进回收站)。
- 页面上不放长说明, 菜单里的 "关于网盘" 两行说清网盘与附件分开, "存到网盘" 在哪。
- 发到群与聊天里的转发 (#157): 选择列表只列能发消息的会话, 邮件群, 信息流群, 系统通知 (`system`), 已删除的群与不认识展示方式的群不列出。
- 先预览后保存 (#158): 点文件进预览页, 不直接下载。图片 (双指缩放, 双击复原), 文本 / 代码 (Range 只读前 1 MB, 宽松 UTF-8), PDF (系统 PdfRenderer 逐页渲染), 音频与视频 (VideoView 播直链, 可拖动; 播不了提示用其他应用打开), 其他与过大的图片 / PDF 显示信息卡。整份文件 (图片, PDF, 用其他应用打开, 发到群的退回) 下到 App 的 `cache/drive-preview/<id>/`, 每次预览前删一天前的, 总量超 300 MB 从最旧的删, 不进下载目录。预览页底部: 保存到手机 (保存过就是 "打开"), 分享链接, 发到群, 用其他应用打开。
- 保存到手机 (#158): Android 10 起存到系统下载目录 `Download/AIOA` (MediaStore, 不要存储权限), 之前的版本存到 App 的外部下载目录。半截是带 `.part` 的 pending 条目, 按 `Range` 续传: 206 接着写, 200 (服务器不认 Range) 或 Content-Range 起点对不上从头写, 403 / 404 / 410 换直链续传, 416 且本地已满算完成, 429 / 5xx / 断网退避重试 3 次。完成后去掉 `.part`, 重名编号 `a (1).txt`。显示进度, 实时速度 (最近 5 秒滑动窗口平均) 与剩余时间; 可暂停, 继续, 取消 (删半截); 最多同时 2 个; 起前台服务, 通知里有进度与速度。完成后可 "打开" 或 "在文件夹中显示" (系统下载列表); 同一文件 (节点 id + 大小) 保存过且文件还在就直接打开。任务与保存记录存本机, 重开 App 后没下完的显示为暂停。
- 传输页 (菜单 "传输", 首页有一行正在传输的摘要): 上传与保存到手机放在一起, 都有速度与剩余时间。
- 上传: 多选, 进度条, 断点续传 (票据与回执存本机, 24 小时内重开 App 只补缺的片), 传输时起前台服务, 切到后台继续。
- 回收站: 恢复, 彻底删除, 清空。我的分享: 链接, 到期, 是否有密码, 复制, 撤销。用量: 令牌有 stats 权限时显示 Drive 总字节与文件数。
- 聊天: 文件消息长按 "存到网盘"。Drive 上的附件服务端复制 (0 字节), R2 上的附件服务端直接把字节转给 Drive (#157), 手机都不用先下载; 只有令牌看不到的情况才退回手机上传。转发文件消息只带引用, 不重新上传。
- 分享链接打开的是 Drive 的 `/s/<id>`: Drive v0.4 起浏览器里是页面 (输入密码, 文件夹列表, 下载按钮), 密码用表单提交后换成 Cookie, 不进地址栏; 非浏览器 (curl, App) 照旧直接下载或拿 JSON。App 里复制链接与密码分开复制。

## 6. 部署

- 默认不用做任何事: 复用 `CFD_TOKEN`, 网盘根是令牌根下的 `/drive` (见 §0), 首次使用自动创建, 旧位置的东西自动迁入。
- Drive 要支持 `X-Drive-Scope` (Drive #18 起), 否则网盘接口回 503 `drive_outdated`。
- 可选: 建一个专用令牌 `{"name":"aioa-drive","scopes":["read","write","stats"],"rootPath":"/"}` 配成仓库 secret `CFD_DRIVE_TOKEN` (配了才同步到 Worker), 网盘根就是 Drive 的 `/drive`, 用量能显示。
- 手机直传要 Drive v0.4 以上, Drive 的公网地址 (`CFD_ORIGIN`, 或 Drive 的 `PUBLIC_URL`) 要能从手机访问。
