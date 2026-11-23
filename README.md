# HX-AIOA

<p align="center"><img src="docs/assets/hero.webp" width="320" alt="HX-AIOA"></p>

个人 All In One App: 随处打开, 实时双工消息, 一眼看清自己的服务器和服务。

安卓端四栏: 总览 (需要我 / 正在发生), 消息, 资源 (探针实时指标), 我的 (外观与连接设置); 手机底部导航, 平板侧边导航。

## 架构

```
Web / 平板 ──WebSocket──┐
                         ├── Worker ── Hub (Durable Object, SQLite, 休眠 WebSocket)
安卓 :link 进程 ─WebSocket┘                    │
                                               └── ACK 超时 → 兜底推送 (MiPush / WxPusher)
外部 Agent ──HTTP POST /api/send──┘
探针 ──WebSocket (有人看时才推指标)──┘
```

- 每条消息有递增序号 `seq`, 客户端重连时带上 `since` 补拉。
- 安卓 `:link` 进程收到消息后回 `ack`; 1.5 秒内没收到 `ack`, 服务端走兜底推送。
- 实时指标采用懒更新, 不写数据库, 见 `docs/features/metrics.md`。
- 详细协议见 `protocol/README.md`。

## 快速开始

```bash
npm install
npm run typecheck

# 服务端 (需要先 npx wrangler login)
cd server
npx wrangler secret put AUTH_TOKEN
npx wrangler deploy

# Web 端
cd client/web
cp .env.example .env.local   # 填服务端地址与 token
npm run dev

# 探针 (在要监控的机器上, Node 22+): App "资源 → 添加主机" 生成一行安装命令, 见 docs/features/terminal.md
# 手动运行: AIOA_SERVER=https://你的域名 AIOA_TOKEN=xxx AIOA_SUBJECT=nas-01 node tools/probe.mjs

# 延迟压测
node tools/bench.mjs --url https://你的域名 --token xxx --count 50
```

接入 GitHub 等数据源: 见 [docs/features/sources.md](docs/features/sources.md) (App 内 "我的" → "添加数据源" 按步骤操作)。

安卓端: 每次推送自动编译签名 APK 并发布到 Releases, 见 `docs/deploy/android-signing.md`。首次打开 app 时填写服务端地址与令牌。

## 注意

- `*.workers.dev` 在中国大陆多数无法直连, 请绑定自己的域名。
- 红米手机需要手动开启: 自启动, 省电策略 "无限制", 多任务页锁定。

开发规范见 `AGENTS.md`, 全部文档见 [docs/README.md](docs/README.md)。
