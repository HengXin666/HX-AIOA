# HX-AIOA

个人 All In One App: 随处打开, 实时双工消息, 可组合的微页面。当前阶段只验证消息推送链路。

## 架构

```
Web / 平板 ──WebSocket──┐
                         ├── Worker ── Hub (Durable Object, SQLite, 休眠 WebSocket)
安卓 :link 进程 ─WebSocket┘                    │
                                               └── ACK 超时 → 兜底推送 (MiPush / WxPusher)
外部 Agent ──HTTP POST /api/send──┘
```

- 每条消息有递增序号 `seq`, 客户端重连时带上 `since` 补拉。
- 安卓 `:link` 进程收到消息后回 `ack`; 1.5 秒内没收到 `ack`, 服务端走兜底推送。
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

# 延迟压测
node tools/bench.mjs --url https://你的域名 --token xxx --count 50
```

安卓端: 用 Android Studio 打开 `client/android/`, 在 `local.properties` 中填写 `aioa.server` 与 `aioa.token`。

## 注意

- `*.workers.dev` 在中国大陆多数无法直连, 请绑定自己的域名。
- 红米手机需要手动开启: 自启动, 省电策略 "无限制", 多任务页锁定。

开发规范见 `AGENTS.md`。
