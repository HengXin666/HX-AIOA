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
- 令牌: 可选密钥 `CFD_DRIVE_TOKEN` (Drive 后台建, 根目录 `/`, 权限 read + write, 要用量再加 stats)。没配时退回 `CFD_TOKEN`, 只看到 `/aioa` (附件所在的目录)。`DRIVE` 绑定与 `CFD_ORIGIN` 缺一项时网盘接口返回 503。
- 附件目录只读: 聊天附件存在 `CFD_TOKEN` 根下的 `/YYYY-MM/`。整盘令牌下是 `/aioa` 本身与 `/aioa/YYYY-MM/...`, 退回模式下是 `/YYYY-MM/...`。网盘接口拒绝在这些位置删除, 移动, 改名, 新建与上传 (409), 读, 下载, 分享, 存一份到别处不受影响。按 id 的写操作先向 Drive 问一次路径 (多 1 次子请求, 只在写时)。

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
| POST | `/uploads {path, name, size, mime, sha256?}` | `/uploads` | 秒传成功直接回 `{ done, node }` |
| PUT | `/chunk?ticket=&i=` | `/uploads/chunk` | 片字节流式转发, 不唤醒 DO |
| POST | `/fold` `/commit` | 同名 | |
| GET/POST | `/shares` | `/shares` | 列表补上 `url`; 新建可带 `expiresIn` (秒) 与 `password` |
| DELETE | `/shares/{id}` | `/shares/{id}` | 撤销 |
| GET | `/stats` | `/admin/stats` | 令牌没有 stats 权限时回 `{ stats: null }` |

主 Hub (访问令牌, 只主人):

- `POST /api/v1/drive/pass` → `{ pass, expires, root, whole }`。没接入回 503。
- `POST /api/v1/drive/save { file, path? }`: 聊天文件存到网盘。文件在 Drive 上时用 Drive 的复制 (只加引用, 0 字节); 在 R2 上或令牌看不到时回 409 `need_upload`, App 改为用本机副本 (没有就先下载) 走分片上传。默认存到 `/聊天文件`。
- `POST /api/v1/drive/attach { id, channel? }`: 网盘文件发到群。把节点复制进附件目录, 登记成一个已传完的 cfd 文件, 回 `{ file: FileRef }`; App 再用 `POST /api/v1/messages { file }` 发出。复制不了 (根目录不含附件目录) 时回 409, App 下载后走普通上传。

## 3. 字节不经 AIOA 的程度

- 下载: Drive 签名直链, 字节走 Drive 公网 (或 TG 直连), 不经 AIOA。直链 6 小时, App 按节点缓存地址。
- 上传: 现在只能经 AIOA 转发。Drive 的分片接口要 Bearer 令牌, 且票据绑定签发它的令牌, 手机没有也不该有 Drive 令牌。每片 (Drive 片大小约 19 MiB) = 1 次 AIOA Worker 请求 + 1 次 Drive 请求, 不进 DO; 1 GB 约 54 + 54 次。
- Drive 侧最小改法 (以后做, 本仓库不改 Drive): `PUT /api/v1/uploads/chunk` 没有 Authorization 时把票据本身当凭证 (HMAC 已签, 校验到期与 `tokenAlive(t.u)`), 再在 `/uploads` 返回里给公网分片地址; 届时 AIOA 在 `uploads` 的返回里多给 `direct` 地址, App 优先直传。

## 4. 请求量

- 一次进入网盘: 先显示本机缓存, 再 1 次 `list` (Worker + Drive 各 1, Drive D1 读约 子项数 行), 没变回 304。不轮询, 只在进入目录, 下拉刷新, 自己改动之后刷新。
- 通行证: 用网盘的那 1 小时里 1 次 DO 请求, 不用不发。
- 写操作: Worker 1 + Drive 1 到 2 (按 id 的写多问一次路径)。
- 主 Hub DO 只在 `pass`, `save`, `attach` 时被唤醒, 都是用户点了才有。

## 5. App

- 入口: 内置空间 "网盘" (`#drive`), 按 home-spaces 规则默认不置顶 (不参与自动补空位), 在 "更多空间" 与标题下的空间切换里; 侧栏有 "网盘" 链接。网盘可用 (问过一次 `pass`) 才出现, 结果记在本机。
- 浏览: 面包屑, 列表 / 网格, 按名字 / 大小 / 时间排序 (文件夹在前), 搜索, 下拉刷新; 目录列表按路径缓存在本机, 先显示缓存再刷新。
- 文件操作 (长按或行尾菜单): 打开 / 预览, 下载, 分享, 发到群, 改名, 移动 (选目录), 删除 (进回收站)。
- 预览: 图片在 App 里看, 2 MB 以内的文本在 App 里看, 视频交给系统播放器直接播直链, PDF 与其他下载后交给系统打开。下载过的文件留在 `files/drive/<id>/`。
- 上传: 多选, 进度条, 断点续传 (票据与回执存本机, 24 小时内重开 App 只补缺的片), 传输时起前台服务, 切到后台继续。
- 回收站: 恢复, 彻底删除, 清空。我的分享: 链接, 到期, 是否有密码, 复制, 撤销。用量: 令牌有 stats 权限时显示 Drive 总字节与文件数。
- 聊天: 文件消息长按 "存到网盘"。
- 分享链接打开的是 Drive 的 `/s/<id>`: 文件直接下载, 文件夹是 JSON 列表; 有密码的分享浏览器里打不开 (Drive 没有输入密码的页面, 只能 `?p=` 或请求头), App 里复制链接与密码分开复制。

## 6. 部署

- 仓库 secret `CFD_DRIVE_TOKEN` 配了才同步到 Worker (deploy workflow)。不配也能用, 只看 `/aioa`。
- Drive 后台建令牌: `{"name":"aioa-drive","scopes":["read","write","stats"],"rootPath":"/"}`。
