# 推送链路可行性验证 - Evidence

## 2026-11-20 本地验证 (wrangler dev, 本机回环)

- `npm run typecheck`: protocol, server, web 均通过。
- `npm run build -w client/web`: 构建通过。
- `node tools/bench.mjs --count 30 --interval 50`: 收到 30/30, p50 7ms, p95 20ms, max 22ms。
- WebSocket 帧验证: `welcome` 正确返回 head; `since` 补拉正确; `ping` 自动回 `pong`; `send` 返回 `sent` 且广播 `msg`; 非法帧返回 `err`。

## 未覆盖

- 安卓端未在沙箱中编译 (无 JDK 与 Android SDK), 需要在 Android Studio 中构建。
- 真实 Cloudflare 部署, 大陆网络延迟, 红米锁屏耗电与内存均未实测。
- MiPush 与 WxPusher 兜底推送的接口参数未经真机核对。
