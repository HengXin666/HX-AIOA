# Web Push 部署与限制

Web 端页面开着时消息走 WebSocket; 页面关了 (浏览器还在运行) 时, 服务端的兜底推送多一个渠道 `webpush`, 经浏览器自带的推送服务 (VAPID, aes128gcm 加密) 把通知送到 Service Worker。设计见 [web-arch.md](../../design/web-arch.md) 第 6 节, 接口见 [v1.md](../../api/v1.md) 1.3 节。

## 1. 生成密钥

```sh
node tools/gen-vapid.mjs mailto:you@example.com
```

打印三项值和对应的 `wrangler secret put` 命令。私钥只放 secret, 不要提交。一个部署只用一对密钥; **换密钥后所有浏览器订阅作废**, 用户要在设置里重新打开推送。

## 2. 配置

三项缺一就当没配置: 渠道不可用, `GET /api/v1/webpush/key` 返回 `{ "key": null }`, 订阅接口返回 503。

| Worker 里 | 内容 |
| --- | --- |
| `VAPID_PUBLIC_KEY` | 公钥, 65 字节未压缩 P-256 点的 base64url |
| `VAPID_PRIVATE_KEY` | 私钥, base64url 的 `d` (32 字节), 也接受整个 JWK |
| `VAPID_SUBJECT` | `mailto:` 或 `https:` 联系地址 |

两种配法 (变量总表见 [env.md](../env.md)):

- **部署同步**: 仓库 variable `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT` 和 secret `VAPID_PRIVATE_KEY` 三项一起配, `服务端部署` workflow 同步到 Worker; 只配一部分部署报错。
- **手动**: 在 `server/` 下执行脚本打印的三条 `npx wrangler secret put`。

## 3. 什么时候发

与安卓厂商推送同一条兜底逻辑, 不新增定时器与 DO 唤醒:

1. 规则动作是 `alert` / `push`, 渠道里有 `webpush` (默认渠道已包含; 自己写了 `channels` 的规则要手动加上)。
2. 安卓 1.5 秒内没有 ACK (手机不在线或没收到), 多条合并成一次。
3. 只发给主人账号的订阅; 该 Web 设备 (`web-` 开头) 此刻有前台长连接 (页面开着) 就跳过, 由页面自己提醒。
4. 推送服务回 404 / 410 就删掉该订阅; 其它错误只记日志。

通知内容只有标题 (发送者), 纯文本摘要 (截断到 140 字), 群, seq, tag; 同一个群用同一个 tag 和 `Topic`, 新通知替换旧的。`alert` 用 `Urgency: high`, `TTL` 一天。

## 4. 限制

- 通知权限只能由用户点击申请; 用户拒绝后只能去浏览器的站点设置里放开。
- **浏览器进程没在运行就收不到** (Linux / Windows 关掉浏览器后); 推送服务会按 TTL 暂存, 浏览器下次启动时补到。
- **Chrome / Edge 的推送服务走 FCM** (Google), 中国大陆网络需要用户自己的代理; Firefox 用 Mozilla 的服务。
- **iOS / iPadOS (16.4+) 必须先 "添加到主屏幕"**, 从主屏幕图标打开后才能申请通知权限; Safari 标签页里不行。
- 浏览器可能自行更换订阅 (`pushsubscriptionchange`); SW 拿不到登录令牌, 不在后台重报; 页面登录后调 `syncPush()` 重报一次 (没变不写库), 设置里重新打开推送也会上报。
- 判断 "页面开着" 看的是该设备的长连接; 半死的连接在断开前会让这台设备收不到 Web Push。
