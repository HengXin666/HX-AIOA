# 推送实验手册

目标: 验证 "延迟 ≤ 3 秒" 与 "后台近乎零耗电, 内存极小" 两条硬指标。

## 1. 部署

1. 绑定自己的域名到 Worker (`wrangler.toml` 中的 `routes`)。
2. `npx wrangler secret put AUTH_TOKEN`
3. `npx wrangler deploy`

## 2. 延迟

- 电脑上: `node tools/bench.mjs --url https://你的域名 --token xxx --count 100`, 记录 p50 / p95。
- 手机锁屏 1 分钟, 5 分钟, 30 分钟后, 分别用 `/api/send` 发一条, 记录通知弹出时间。

## 3. 后台功耗与内存

- 设置: 自启动开, 省电策略 "无限制", 多任务页锁定, 电池白名单。
- 退出界面后执行 `adb shell dumpsys meminfo com.hengxin.aioa:link`, 记录 PSS。
- 满电锁屏 8 小时, 对比 "设置 → 电池" 中本应用的耗电占比。
- 重启手机, 不打开 app, 发一条消息, 确认能收到。

## 4. 待验证的调参

- `PING_INTERVAL_SEC` (安卓, 默认 60 秒): 越长越省电, 但运营商 NAT 可能更早断开。
- `FALLBACK_DELAY_MS` (服务端, 默认 1.5 秒): 长连接没回 ack 时多久走兜底推送。

## 5. 兜底通道

- WxPusher: 配置 `WXPUSHER_APP_TOKEN` 与 `WXPUSHER_UID` 即可。
- MiPush: 需要在小米开放平台注册应用, 接入 SDK 后客户端发送 `reg` 帧上报 regId, 服务端配置 `MIPUSH_APP_SECRET` 与 `MIPUSH_PACKAGE`。
