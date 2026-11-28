# 网盘 (HX-CF-Drive, #154)

把 [HX-CF-Drive](https://github.com/HengXin666/HX-CF-Drive) 当网盘接进 App: 浏览, 上传下载, 预览, 整理, 回收站, 分享。网盘只是 Drive 目录树的一个视图, AIOA 不复制元数据, 不写自己的库。聊天附件仍按 [files.md](files.md) 的存储路由走, 两者共用同一个 Drive。

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
  - 根是 `/aioa` (按 files.md 建的令牌): 网盘只看 `/aioa`, 设置的 "存储" 页与网盘首页有提示。
  - 想看整个盘: 在 Drive 后台把 `CFD_TOKEN` 的根目录直接改成 `/` 即可。网盘自动按整盘显示; 聊天附件自动改写到 `/aioa/YYYY-MM/` (见 files.md), 和以前同一个目录, 老附件按节点 id 读删不受影响; 附件目录照样只读。最多 10 分钟后生效 (isolate 缓存)。
  - 也可以另配可选密钥 `CFD_DRIVE_TOKEN` (根目录 `/`, read + write, 要用量再加 stats), 网盘用它, 附件仍用 `CFD_TOKEN`。
  - `DRIVE` 绑定与 `CFD_ORIGIN` 缺一项时网盘接口返回 503。
- 附件目录只读: 聊天附件在 Drive 的 `/aioa/YYYY-MM/`。令牌根是 `/` 时是 `/aioa` 本身与 `/aioa/YYYY-MM/...`, 根是 `/aioa` 时是 `/YYYY-MM/...`。网盘接口拒绝在这些位置删除, 移动, 改名, 新建与上传 (409), 读, 下载, 分享, 存一份到别处不受影响。按 id 的写操作先向 Drive 问一次路径 (多 1 次子请求, 只在写时)。

## 2. 接口 (Worker, 都要通行证)

前缀 `/api/v1/drive`。路径参数一律先规范化: 必须以 `/` 开头, 去掉重复的 `/`, 拒绝 `.` `..` 段, 反斜杠与控制字符, 最长 1024; 节点 id 只收 `[A-Za-z0-9_-]{1,64}`; 名字不能含 `/`, 不能是 `.` `..`, 最长 255。

| 方法 | 路径 | 转给 Drive | 说明 |
| --- | --- | --- | --- |
| GET | `/list?path=` | `/fs/list` | 返回 `{ path, items }`; 带弱 ETag, `If-None-Match` 命中回 304 |
| GET | `/search?q=` | `/fs/search` | Drive 按令牌限 6 次/分钟, App 只在提交时搜 |
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

- `POST /api/v1/drive/pass` → `{ pass, expires, root, whole }`。没接入回 503。
- `POST /api/v1/drive/save { file, path? }`: 聊天文件存到网盘。文件在 Drive 上时用 Drive 的复制 (只加引用, 0 字节); 在 R2 上或令牌看不到时回 409 `need_upload`, App 改为用本机副本 (没有就先下载) 走分片上传。默认存到 `/聊天文件`。
- `POST /api/v1/drive/attach { id, channel? }`: 网盘文件发到群。把节点复制进附件目录, 登记成一个已传完的 cfd 文件, 回 `{ file: FileRef }`; App 再用 `POST /api/v1/messages { file }` 发出。复制不了 (根目录不含附件目录) 时回 409, App 下载后走普通上传。

## 3. 字节不经 AIOA 的程度

- 下载: Drive 签名直链, 字节走 Drive 公网 (或 TG 直连), 不经 AIOA。直链 6 小时, App 按节点缓存地址。
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
- 文件操作 (长按或行尾菜单): 打开 / 预览, 下载, 分享, 发到群, 改名, 移动 (选目录), 删除 (进回收站)。
- 发到群与聊天里的转发 (#157): 选择列表只列能发消息的会话, 邮件群, 信息流群, 系统通知 (`system`), 已删除的群与不认识展示方式的群不列出。
- 预览: 图片在 App 里看, 2 MB 以内的文本在 App 里看, 视频交给系统播放器直接播直链, PDF 与其他下载后交给系统打开。下载过的文件留在 `files/drive/<id>/`。
- 上传: 多选, 进度条, 断点续传 (票据与回执存本机, 24 小时内重开 App 只补缺的片), 传输时起前台服务, 切到后台继续。
- 回收站: 恢复, 彻底删除, 清空。我的分享: 链接, 到期, 是否有密码, 复制, 撤销。用量: 令牌有 stats 权限时显示 Drive 总字节与文件数。
- 聊天: 文件消息长按 "存到网盘"。Drive 上的附件服务端复制 (0 字节), R2 上的附件服务端直接把字节转给 Drive (#157), 手机都不用先下载; 只有令牌看不到的情况才退回手机上传。转发文件消息只带引用, 不重新上传。
- 分享链接打开的是 Drive 的 `/s/<id>`: Drive v0.4 起浏览器里是页面 (输入密码, 文件夹列表, 下载按钮), 密码用表单提交后换成 Cookie, 不进地址栏; 非浏览器 (curl, App) 照旧直接下载或拿 JSON。App 里复制链接与密码分开复制。

## 6. 部署

- 默认不用做任何事: 复用 `CFD_TOKEN`, 网盘范围就是这个令牌的根目录 (见 §1)。
- 想看整盘, 二选一: 在 Drive 后台把 `CFD_TOKEN` 的根目录改成 `/` (附件自动适配); 或建一个专用令牌 `{"name":"aioa-drive","scopes":["read","write","stats"],"rootPath":"/"}` 配成仓库 secret `CFD_DRIVE_TOKEN` (配了才同步到 Worker)。
- 手机直传要 Drive v0.4 以上, Drive 的公网地址 (`CFD_ORIGIN`, 或 Drive 的 `PUBLIC_URL`) 要能从手机访问。
