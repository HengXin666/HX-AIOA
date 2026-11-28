# Web 端架构 (CF 部署, HX-UI 2, 电脑优先)

> 专项 issue: 见 #155。本文是 Web 端的设计定稿草案, 实现时有改动先改本文。桌面客户端 (Arch Linux / AppImage) 暂时搁置, 只在第 9 节记录候选方案。

## 1. 结论一览

| 问题 | 结论 |
| --- | --- |
| 部署在哪 | 同一个 Worker 的静态资源 (`[assets]`), 域名仍是 `aioa.woa.qzz.io`, 页面和接口同源 |
| 为什么不单开 Pages / 子域 | 跨域时每个带 `Authorization` 的请求先发一次 OPTIONS 预检, Worker 请求翻倍; 同源没有预检, 也不用维护第二个项目 |
| 页面请求花不花额度 | 静态资源请求免费且不限量, 不进 Worker; 路由用 hash (`/#/c/<群>`), 每次导航都是 `/` 这一个文件, 也不进 Worker |
| 框架 | React 19 + HX-UI 2 (按路径单独引组件, 不引根入口), Vite 构建; 现有 `client/web` (原生 TS, 约 5 千行, 功能停在早期) 不再扩展, 新版本整体替换 |
| 布局 | 电脑优先: 侧栏 + 列表 + 详情三栏, 宽屏再加右侧检查栏; 窄屏退回与安卓相同的单栏规则 |
| 实时 | 每个浏览器只开一条 WebSocket (多标签共用), 数据靠推送同步, 不轮询 |
| 推送 | 页面开着走 WebSocket; 页面没开走浏览器原生 Web Push (VAPID), 作为兜底推送的新渠道 `webpush` |
| 链接 | 一律新标签页打开, 不内嵌浏览器 |
| 代理 | Web 端不做, 用户用自己的系统代理 |
| 图表 | 自绘: 时序用 Canvas, 小图用单个 SVG path; 不用 Recharts 跑实时数据 |
| 插件 | 清单新增客户端兼容声明与版本标注, 市场 CI 严格校验, 见第 8 节 |

## 2. 部署 (CF)

### 2.1 目录与构建

```
client/web/              Web 端源码 (React + HX-UI), 构建产物 client/web/dist
server/public/           现有静态资源 (install.sh, probe*.mjs, hxaioa.mjs)
```

部署流程 (`deploy.yml`) 在 `wrangler deploy` 前多一步: `npm run build -w client/web`, 把 `dist/` 拷进 `server/public/` (与探针脚本同一目录, 文件名不冲突, CI 检查)。一次部署同时发服务端与页面, 版本天然一致。

路由用 hash (`/#/`, `/#/c/<群>`, `/#/settings`), 不用 SPA 回退 (W1 实现时定):

- 地址栏里只有 `/` 一个文件, 命中静态资源直接返回, 不进 Worker, `wrangler.toml` 一行不改。
- 不用 `not_found_handling = "single-page-application"` + `assets_navigation_prefers_asset_serving`: 那样要把 `/api/*` `/ws` `/health` `/join/*` 全列进 `run_worker_first`, 数组写法要 wrangler 4 (现在是 3.114), 以后 Worker 加路径还得同步; 漏一个, 在浏览器里直接打开那个地址就会拿到页面。
- 代价只是地址里多一个 `#`。Web Push 点开通知用 `/#/c/<群>` 跳转; 页面 id 与安卓深链 `hxaioa://<id>` 的对应关系不变。

### 2.2 缓存

- `index.html`: `Cache-Control: no-cache` (带 ETag, 304 也不进 Worker)。
- 带哈希的 `assets/*`: `public, max-age=31536000, immutable`。用 `_headers` 文件声明, 不经过 Worker。wrangler 3 若不认 `_headers`, 资源层默认 `max-age=0, must-revalidate` + ETag, 只是多一次 304, 仍不花额度。
- 版本号: 构建时写入 `version.json` (`{ web: <构建号>, sha }`), 静态文件, 查它不花额度。

### 2.3 版本偏移

部署后已打开的旧页面去拿旧的懒加载块会 404 (新版本里没有)。处理: 监听 `vite:preloadError`, 先查 `version.json`, 版本变了就提示 "有新版本, 刷新" 并在用户点后刷新; 打开中的输入不丢 (草稿存本地)。

### 2.4 额度规则 (Web 端硬性)

| 规则 | 原因 |
| --- | --- |
| 只开一条 WebSocket, 多个标签页用 `SharedWorker` 共用 (不支持时用 `BroadcastChannel` 选主) | 每次连接 = 1 Worker + 1 DO 请求; 10 个标签不能变 10 条 |
| 不写任何定时 `fetch` 轮询; 列表靠 `pdata_sync` / `chat_sync` / `space_update` 等推送帧失效后再拉 | 轮询是额度的头号杀手; Web lint 拦 `setInterval` + `fetch` |
| 心跳沿用协议 ping (服务端 `setWebSocketAutoResponse` 回), 不唤醒 DO | 现有约束 |
| 指标只在可见时 `watch` (IntersectionObserver + `visibilitychange`), 页面隐藏立即退订 | 探针有人看才推 |
| 读接口先看本地 IndexedDB 缓存再带 ETag 校验 | 首屏不等网络, 304 仍算请求, 所以只在推送说变了或用户进页时才校验 |
| 重连指数退避, 页面隐藏且断线时不重连, 回到前台再连 | 避免后台标签反复握手 |
| 预算: 一个常开的 Web 标签一天 Worker + DO 请求合计不超过 500 次 | 写进 e2e, 超了失败 |

## 3. 前端技术选型

| 层 | 选择 | 说明 |
| --- | --- | --- |
| 视图 | React 19 | HX-UI 2 是 React 组件库, 直接用; 不引 Next, 纯 SPA |
| 组件 | `@hx/ui` 2.x, 锁版本 (与安卓共用 `design/hx-ui.lock.json`) | 只按路径引 (`@hx/ui/ui/button`), 不引根入口, 保证摇树 |
| 样式 | Tailwind v4 + `@hx/ui/tailwind.css` | 皮肤用 `ink`; 不再用 `tools/gen-tokens.mjs` 生成的 Web CSS |
| 路由 | 自写约 100 行的 history 路由, 路由表由 `docs/design/ui-spec/pages.json` 生成 | 页面 id 与安卓深链 `hxaioa://<id>` 一一对应, 通知点开落到同一页 |
| 状态 | 现有 `Store` 的思路 (按 topic 订阅) 改成 `useSyncExternalStore` | 不引 Redux / Zustand |
| 协议 | `@hx-aioa/protocol` (已是 workspace 包) | 与服务端, 安卓同源 |
| 本地缓存 | IndexedDB (消息, 列表, 设置), Cache Storage (应用外壳) | 离线也能打开看历史 |

### 3.1 性能预算 (CI 检查)

| 项 | 上限 |
| --- | --- |
| 首屏 JS (gzip) | 160 KB, 图表, 邮件详情, 设置等按路由懒加载 |
| 首屏 CSS (gzip) | 30 KB |
| 空闲时 CPU | 0: 没有常驻动画, 没有定时器 (除 WebSocket 由 SharedWorker 管) |
| 收到一条消息的主线程耗时 | 4 ms 以内 (只重渲染受影响的行) |
| 长列表 | 超过 200 行一律虚拟滚动 |

### 3.2 HX-UI 用法限制 (省 CPU / GPU)

- 不用: `effects/` 整层 (`SpotlightCard` `BorderBeam` `Marquee` `Backdrop aurora` `GlassPanel`), `typography/` `site/` `commerce/` `blocks/` `studio`; 它们是营销页用的, 常驻动画或大面积 `backdrop-filter` 会让 GPU 一直合成。
- 慎用: `motion/` 只允许进入动画 (一次性), 不允许循环; 全部尊重 `prefers-reduced-motion`; `Spin` 只用 `fixed`。
- 阴影只给浮层 (抽屉, 对话框, 菜单); 平铺卡片只描边。不对 `box-shadow` `filter` 做过渡。
- 门禁: Web 构建跑一个导入白名单检查 (类似 `LayoutLintTest`), 引了禁用目录就失败。

## 4. 电脑端布局

沿用安卓新总览 (`docs/design/ui-spec/home-spaces.md`) 的信息结构: 侧栏 + 空间, 同一套页面 id, 只换版式。

```
≥1280px
┌──────────┬──────────────┬──────────────────────────────┬────────────┐
│ 侧栏 260 │ 列表 340     │ 详情 (会话 / 空间内容)       │ 检查栏 320 │
│ 账号     │ 搜索         │ 顶栏: 标题 · 操作             │ 群资料     │
│ 空间     │ 会话 / 事件  │                              │ 事件详情   │
│ 消息     │              │                              │ 成员       │
│ 工作区   │              │ 输入框 (会话页)              │            │
└──────────┴──────────────┴──────────────────────────────┴────────────┘
720-1279px: 侧栏收成 64px 图标栏, 检查栏改为盖在详情上的右抽屉
<720px: 与安卓同规则 (单栏, 子页推入, 底部抽屉)
```

| 安卓容器 | 电脑上 |
| --- | --- |
| 栏根页 | 列表栏 + 详情空态 |
| 子页 (右侧推入, 盖住底栏) | 在详情栏打开, 列表保留选中态; 再深一层用面包屑, 不叠页 |
| 底部抽屉 | 右侧检查栏 (宽屏) / 右抽屉 (中屏); 选择类用 Popover |
| 对话框 | 不变 |
| 长按菜单 | 右键菜单 + 行尾 "⋯" 悬停出现 |
| 左滑操作 | 悬停出现的行内按钮 |

电脑特有:

- `Ctrl+K` 命令面板: 搜群, 搜空间, 跳页面, 执行插件命令 (`contributes.commands`)。
- 快捷键: `Alt+↑/↓` 切会话, `Esc` 关检查栏, `Ctrl+Enter` 发送 (可改为 Enter 发送)。
- 分栏宽度可拖, 存账号设置 (与 `homeTabs` 一起, 不多发请求)。
- 拖放上传: 拖到会话即发送文件, 走现有文件票据接口。

### 4.1 手机浏览器

结论: 能用, 做到 "不比 App 难用", 但不承诺和 App 一样; 安卓手机提示一次装 App, 不强制。

| 方面 | 手机网页 | 安卓 App |
| --- | --- | --- |
| 版式 | `<720px` 单栏 + 底栏, 子页推入, 与安卓同一套页面 id 与层级 | 同 |
| 消息, 会话, 设置, 图表 | 都有, 同一份代码 | 同 |
| 页面关着收消息 | Web Push: 安卓 Chrome 在浏览器没打开时也能收 (走 FCM, 大陆要代理); iOS 要先 "添加到主屏幕" (16.4+) | 自有常驻连接 + 小米推送, 不依赖 Google |
| 内置浏览器, 订阅代理, 保活, 耗电, 免安装更新 | 不做 | 有 |
| 扫码加入 | 改粘贴邀请链接 | 扫码 |

- 安卓手机浏览器打开时, 登录页显示一次 "建议装 App" (关掉写本地, 不再出现); iOS 没有 App, 不提示。
- 不做 UA 跳转, 不拦截: 有人就是想在别人的手机上临时看一眼。
- 输入框贴底并留安全区 (`env(safe-area-inset-bottom)`); 触控目标不小于 40px; 悬停才出现的按钮在触屏上常显。
- W2 加 PWA 清单 (图标, `display: standalone`), 能添加到主屏幕, iOS 才能收 Web Push。

## 5. 功能映射 (安卓 → Web)

| 安卓功能 | Web 端 | 说明 |
| --- | --- | --- |
| 内置浏览器 (`Browser.open`) | 新标签页 `target="_blank" rel="noopener noreferrer"` | 统一入口 `openLink(url)`; 站内页面 id 的链接 (`hxaioa://<id>`) 走内部路由, 不开新页 |
| HTML 卡片, 邮件原文 (WebView) | 沙箱 iframe `sandbox="allow-popups allow-popups-to-escape-sandbox"` + `<base target="_blank">`, 不给脚本 | 图片默认拦截, 与安卓同规则 |
| 订阅代理 (mihomo), 节点, 长连接走代理 | 不做 | 用户自己的系统 / 浏览器代理 |
| 自动更新 (APK, 增量补丁) | `version.json` + Service Worker 更新, 提示刷新 | 无安装 |
| 系统通知, 通知渠道 | Notification API + Web Push | 第 6 节 |
| 后台保活, 电池优化, 自启动, 耗电周报 | 不做 | 浏览器管 |
| 系统权限页 | 只剩 "通知权限" 一行 | |
| TG 直连 (本机存 Bot 令牌, Keystore) | 首版不做 | 浏览器里存令牌不安全; 以后要做用 WebCrypto 不可导出密钥加密后存 IndexedDB |
| 调试模式 (请求分布, 耗电) | 只保留请求分布 | 耗电不适用 |
| 头像裁剪, 图标上传, SVG 光栅化 | `canvas` 实现, 同样上传 96px PNG | 接口不变 |
| 文件下载 | `<a download>` / 直链, 交给浏览器下载 | |
| 扫码加入 | 改为粘贴邀请链接 | 电脑没有摄像头场景 |

设置页 (`docs/client/android/settings-map.md`) 里 "连接 · 代理" "系统 · 系统权限" 的安卓项在 Web 端不显示; "服务端" 一项在 Web 端也不需要 (同源), 只显示账号与连接状态。

## 6. 推送 (浏览器原生通道, W3 已做)

```
页面开着: WebSocket 收消息 → 页面不在前台时 SW registration.showNotification
页面没开: Hub ACK 超时 → 兜底推送 → webpush (VAPID, aes128gcm) → 浏览器推送服务 → SW push 事件 → 通知
```

- 渠道: `DeliveryChannel` 加 `webpush`, 与 `mipush` `wxpusher` 并列, 在 `server/src/notify.ts` 里实现。加密 (RFC 8291) 与 VAPID 签名 (RFC 8292) 用 Worker 自带 WebCrypto (P-256 ECDH, HKDF, AES-GCM, ES256), 不引依赖。
- 订阅: 浏览器 `PushManager.subscribe` 后 `PUT /api/v1/devices/{device}/webpush` 存 `{ endpoint, p256dh, auth }`, 每设备一行, 只在订阅变化时写 (行写入可以忽略)。推送服务返回 404 / 410 就删掉该行。
- 判断 "页面开着": 该设备 WebSocket 在线且 ACK 正常就不发 Web Push; 与安卓 `:link` 的 ACK 超时走同一条兜底逻辑, 不新增定时器与 DO 唤醒。
- 额度: 推送是 DO 里的出站 `fetch` (子请求), 不算 Worker / DO 请求; 不新增 cron。
- 密钥: VAPID 私钥 `VAPID_PRIVATE_KEY` (secret), 公钥 `VAPID_PUBLIC_KEY` (var), 主体 `VAPID_SUBJECT`; 按规范同一个提交更新 `docs/deploy/env.md`。不配就不提供 Web Push, Web 端只靠 WebSocket。
- 限制 (写进界面提示): 通知权限必须由用户点击申请; Linux / Windows 上浏览器进程没在运行时收不到; Chrome 的推送服务在 FCM, 大陆网络需要用户自己的代理, Firefox 用 Mozilla 的服务。

实现 (W3) 与上面的差异, 部署见 [deploy/web/push.md](../deploy/web/push.md):

- 订阅存新表 `webpush` (账号 + 设备一行), 不复用安卓 `pushToken` 的 KV 单键; 兜底只发给主人账号的订阅 (与 mipush 一致), 子号的订阅先存着。
- Web 端不发 ACK, "页面开着" 改为看该设备 (`web-` 开头) 有没有前台长连接, 有就跳过; 是否触发兜底仍只看安卓 ACK。没配 VAPID 或主人没有订阅时, 不会因为 webpush 去等 ACK 超时。
- `VAPID_PUBLIC_KEY` / `VAPID_SUBJECT` 在仓库里是 variable, 部署时和私钥一起写成 Worker secret (三项缺一部署报错)。
- 规则默认渠道加了 `webpush`; 自己写了 `channels` 的规则不会自动加。
- 同一个群用同一个 tag 与 `Topic` (tag 的哈希), 还没送达的旧通知被新的替换; SW 只在没有可见窗口时弹通知, 不缓存不拦截 fetch。
- 客户端 `core/push.ts` 多导出 `syncPush()`: 浏览器自己换订阅时 SW 拿不到令牌, 由页面登录后重报一次。

## 7. 图表重做

### 7.1 现状

| 端 | 实现 |
| --- | --- |
| 安卓 / 桌面画廊 | `client/android/ui` 自绘: `LineChart` `Sparkline` `ComboChart` `MixChart` `DualMixChart` `RadialBars` `AreaChart` `Ring` `Heatmap` `Meter`, 色值由 `ChartPalette` 从 HX-UI 令牌取并补对比度 |
| Web 旧版 | `components/chart.ts` 手写 SVG 折线, 每次更新整张重建 |
| HX-UI 2 | Recharts 3 封装 (`HxLineChart` 等), SVG, 每次数据变化走 React 协调 |

Recharts 适合静态报表; 实时指标每秒重渲染整张 SVG, 点多时主线程与合成层开销都大, 不用于实时。

### 7.2 Web 图表层 `client/web/src/charts/`

| 图 | 渲染 | 用在 |
| --- | --- | --- |
| 时序折线 / 面积 (实时指标, CF 用量, 趋势) | Canvas 2D, 数据环形缓冲, 新点到达只画增量 | 资源页, CF 额度, GitHub 走势 |
| 柱状 / 组合 (每日柱, 双轴) | Canvas 2D | GitHub 每日, 周报 |
| 热力格 (贡献图) | 一个 SVG, 每级颜色一条 `path` (5 个节点, 不是 371 个 `rect`) | GitHub, 总览 |
| 迷你折线, 环, 进度 | 单个 SVG path | 行内, 卡片 |

规则:

- 颜色只读 HX-UI 令牌 (`--chart-1..n`), 对比度补正算法从 `ChartPalette.kt` 移植一份 TS, 两端用同一组测试数据核对。
- 只在可见时画: IntersectionObserver 不可见就停; `document.hidden` 停; 数据合并到下一帧 (`requestAnimationFrame`), 一帧最多画一次; 实时图刷新上限 1 次 / 秒。
- 按 `devicePixelRatio` 设画布尺寸, 用 `ResizeObserver` 改尺寸, 不在 `resize` 里全量重算。
- 电脑交互: 悬停十字线与数值提示, 拖选放大时间范围, 双击还原, 图例点击开关序列; 手机仍是点按。
- 入场动画只在首次加载做一次, 增量数据不动画 (对应 HX-UI 的 `matchAppend` 思路); 尊重减弱动效。
- 静态报表页 (周报导出等) 可以按需懒加载 HX-UI 的 Recharts 图表, 不进首屏。

### 7.3 电脑端适配

- 资源页: 主机卡片网格 (`AutoGrid` minmax 320px), 点开主机详情在详情栏用大图 (CPU / 内存 / 网络叠在同一时间轴, 共享十字线)。
- CF 额度: 一屏放下五项额度条 + 按 worker 拆分的堆叠图, 不再逐项点开。
- GitHub: 热力格整年一行铺开 (53 列), 下面走势图与热力格共用时间轴, 点格子联动。

## 8. 插件: 客户端兼容声明与版本校验

> W5 已做 (#156), 接口与字段以 `docs/api/plugins.md` 的 "按端兼容" 为准。与下文设计的差异见 8.5。

### 8.1 问题

现在清单只有 `engines.aioa` (宿主协议大版本), 说的是服务端; 插件里的工作台组件, 主题令牌, WebView 插槽都是按安卓做的, Web 端能不能用没有任何声明, 也不知道插件是对着哪个客户端版本开发的。

### 8.2 清单字段 (`api: "2"` 只加不改)

```jsonc
{
  "engines": {
    "aioa": "^2",          // 服务端协议, 不变
    "android": ">=152",    // 安卓构建号 (android-N 的 N)
    "web": ">=1"           // Web 构建号 (version.json 的 web)
  },
  "clients": ["android", "web"],   // 声明支持的端; 没写 = 只有安卓 (存量插件的真实情况)
  "builtWith": { "android": 153, "web": 1 },  // 开发与验证时用的版本, 展示与排查用
  "contributes": {
    "widgets": [{ "id": "hengxin666.todo.board", "clients": ["android"] }]  // 单项可再收窄
  }
}
```

- 没有 `clients` 的存量插件按 `["android"]` 处理: Web 端市场里显示 "仅安卓", 可以在安卓上装, Web 端不显示它的空间与组件, 数据照常同步。
- 客户端构建号统一为整数 (安卓 versionCode, Web 部署构建号), 范围写法复用 `semver.ts` (`N` 视为 `N.0.0`)。
- 只依赖服务端与 Agent 的插件 (L2a / L3, 没有界面贡献) 写 `"clients": ["*"]`。

### 8.3 运行时

- 握手: 客户端在 `/api/v1/stream` 上除 `pv` 外带 `client=web|android&cb=<构建号>`; 服务端按它过滤 `GET /plugin-contrib/{point}` 与市场列表, 每项附 `client: { level: ok | update | unsupported, need? }`。
- `update`: 插件要求的构建号高于当前客户端, 显示 "需要更新到 xx", 灰掉该插件的界面贡献, 其余不受影响 (与握手三档同一思路)。
- `unsupported`: 不在 `clients` 里, 列表里标 "仅安卓 / 仅 Web", 不提供启用到该端的界面入口。

### 8.4 市场 CI (`npm run check:plugins` 加严)

1. 新增或升版本的插件必须写 `clients` 与对应 `engines.<端>`, 否则失败 (存量插件不升版本不追究)。
2. 能力表: `protocol/src/v1/client-caps.ts` 记录每个端从哪个构建号起支持哪些组件类型 (`todo` `list` `chart`...), 扩展点, 权限 (Web 的 `ui.webview` 是沙箱 iframe)。插件 `space` 里用到的组件类型, `contributes` 的扩展点, 必须在它声明的每个端的最低构建号上都支持, 否则失败并列出缺哪些。
3. 声明的最低构建号必须真实存在: 安卓查 Release 标签 `android-N`, Web 查 `main` 上的构建号; 不能写未来版本。
4. 能力表由客户端维护: 安卓新增组件类型时改能力表要附画廊截图; Web 同理附截图测试。能力表变化不触发插件重新校验以外的任何部署。
5. 报告里加一张 "插件 × 端" 矩阵 (支持 / 需更新 / 不支持), 写进运行摘要。

### 8.5 实现与设计的差异 (W5)

- 构建号范围只允许 `>=N`, `<N`, `*` (不允许 `^N`, `~N`, 精确值): 构建号是整数, `^121` 按 semver 只含 121 一个号, 容易写错。
- 能力表 (`client-caps.ts`) 除组件类型, 扩展点, 权限外多了 `space` (能不能渲染插件工作台) 与 `native` (客户端手写了这个插件的界面, 如安卓 GitHub 接入页自 121 起); 只有客户端渲染的扩展点 (`commands`, `widgets`, `settings`, `core.theme.base`, `core.chat.renderer`) 与 `ui.webview` 要看端, 其余在服务端执行。主题令牌安卓与 `THEME_TOKENS` 同名, 表里不单列映射, Web 接主题时再加。
- Web 能力表现在为空 (React 版只有聊天), 所以存量插件都只写 `["android"]`; Web 接上工作台组件后改能力表, 再给插件加 `web`。
- 存量插件写的最低构建号按功能真实上线的 Release 定: 待办 `>=121` (组件改读 pdata), GitHub 接入 `>=121`, GitHub 授权 `>=110` (设置页)。
- "构建号真实存在": 安卓要求正好有 `android-N` 标签, Web 要求是 `deploy.yml` 在 main 上一次成功运行的号; CI 离线 (查不到) 时降级为按能力表 `known` 判断并警告, 超过 `known` 仍然失败。没有基线 (`BASE`, 本地直接跑) 时判断不了新增或升版本, 缺端声明只警告。
- 握手参数除 `/stream` 与 `/compat` 外, `GET /plugins`, `/plugin-contrib/{point}`, `/spaces` 也读 (HTTP 请求不经过长连接); 没带按安卓。`/compat` 与 `welcome.compat` 回带认下的 `client`。
- 服务端拉任何市场源都跑同一个 `checkManifest` (第三方与私有源 #118 已实现), 只是不查构建号是否发布过 (部署的能力表可能比客户端旧)。
- 安卓 / Web 市场与详情页显示 "仅安卓 / 仅 Web / 需要更新到 N" 的界面还没做: 服务端已给 `client.level` 与 `need`, 客户端各自接。

## 9. 桌面客户端 (搁置, 只记录)

需求: Arch Linux 优先, AppImage 直接运行, 读写配置, 自动升级。候选:

| 方案 | 复用 | 代价 |
| --- | --- | --- |
| Compose Multiplatform Desktop | `client/android/ui` 已是 KMP (`jvm("desktop")`), 画廊已在电脑上跑; 组件, 令牌, 图表全部复用 | 带 JVM, AppImage 约 80-120 MB; 内存比原生大 |
| Tauri 2 | 直接复用 Web 端 | WebKitGTK 在 Linux 上渲染与性能一般, 和 "原生 UI" 的诉求相反 |
| Qt 6 / QML | 无 | 全部重写, 成本最高 |

倾向 Compose Desktop: 成本远低于 Qt, 且与安卓同一套组件。配置放 `$XDG_CONFIG_HOME/hx-aioa/`; AppImage 自动升级用 zsync 增量 (`.AppImage.zsync` 随 Release 发布), 与安卓 `update.json` 同一个发布流程。重启这条线时单开 issue。

## 10. 分期

| 期 | 内容 | 完成标准 |
| --- | --- | --- |
| W0 | 本文定稿; issue 标签按端拆分 (`安卓` / `Web`); 文档目录按端整理 | 合并 |
| W1 (已做) | `client/web` 换成 React + HX-UI 骨架: 登录 (访问令牌只在内存, 不再把 token 打进包), 三档布局, 会话列表与聊天收发, hash 路由, `_headers`, `version.json`, 版本偏移提示; `deploy.yml` 随服务端一起部署 | 部署后打开页面 Worker 请求数为 0 (导航与静态资源) |
| W2 (已做, 差异见 10.1) | 连接层: SharedWorker 单连接, IndexedDB 缓存, 推送失效; 三栏布局; 消息与会话 | 常开 24 小时请求数在预算内 |
| W3 (已做) | Web Push 渠道 (服务端 + SW), 设置页 "通知" 开关 | 关掉页面后 3 秒内收到通知 (浏览器在运行) |
| W4 (已做, 差异见 10.1) | 图表层与资源 / CF 额度 / GitHub 页 | 实时图隐藏时 CPU 为 0, 可见时单核占用 < 2% |
| W5 (已做, 差异见 8.5) | 插件兼容声明, 能力表, 市场 CI, 握手带端与构建号 (#156) | 存量插件在 Web 显示 "仅安卓"; 缺能力的 PR 被 CI 拦下 |

### 10.1 W2 / W4 实现与设计的差异

连接与缓存:

- 一个浏览器一条 WebSocket: 优先 SharedWorker (`core/link-worker.ts`); 不支持时 `BroadcastChannel` + `navigator.locks` 选主标签持有, 主标签关掉后下一个标签接手 (此时重连一次); 两者都没有才每页一条。三种方式共用 `core/link-hub.ts`, 页面侧 `link` 的 API 不变。
- 标签关闭用 "每个标签持有一把锁, 持有方排队等这把锁" 发现, 不靠心跳; 新标签加入时补发最后一份 `welcome` `probes` `hosts` `agents` `online` 与各群 `presence`, 不重放消息。各标签的 `watch` 取并集后发, 空集合且没发过时不发。
- 令牌: 持有方握手时向一个可见标签要访问令牌, 快到期就重要; 刷新令牌跨标签用锁串行 (刷新令牌会轮换, 并发刷新会互相作废)。任一标签退出登录, 其他标签经 `storage` 事件一起退出。
- 版本偏移: SharedWorker 脚本带哈希, 部署后新旧页面各连一条, 旧页面刷新后恢复一条。
- IndexedDB 只有一张键值表 (库 `aioa`, 键带账号 id): 会话列表 + ETag + 每群最后一条, 每群最近 100 条消息。应用外壳的 Cache Storage 归 W3 的 Service Worker, 这里没做。打开会话时拉最新一页, 满页时丢掉缓存里更早的 (避免中间有缺口), 往上翻再按页补。
- 未读条数按本地缓存的消息数 (最多 100 条, 超过显示 99+), 没缓存只显示圆点; 已读用 `PATCH /chats/{群} { read }`, 1.5 秒内合并。输入草稿存 `localStorage`。
- 发送失败 (没连上或 10 秒没回 `sent`) 留在列表底部, 可重试 (换新 cid) 或放弃。

界面:

- 路由仍是手写 hash 路由, 没有由 `pages.json` 生成, 页面 id 与安卓深链的对应还没做。
- 没做: 超过 200 行的虚拟滚动, 分栏拖宽, 拖放上传, `Ctrl+Enter` 发送选项, 右键菜单 (用行尾 "⋯", 触屏常显), 输入框的 @ 选择器 (只做了显示高亮与 "@ 到我" 描边), 合并转发详情 (只显示摘要卡片)。
- 群资料: 宽屏 320px 右栏 (开关记在本地), 中屏右抽屉, 手机底部抽屉; 成员分页, 打开时请求一次 `presence`。
- PWA 图标由安卓 `ic_app.png` (192px) 放大到 512, 清晰度一般, 以后换矢量源; `maskable` 图标加了安全边距。
- `index.css` 排除了 HX-UI 不用的目录 (`effects` `text` `backgrounds` `stage` 等) 的类名扫描, 首屏 CSS gzip 30.7 KB 降到 27.3 KB。首屏 JS gzip 146.4 KB; 总览, 资源 (含图表层), 设置, 命令面板, 群资料都是懒加载块。

图表与资源页:

- 时序图增量绘制 = 绘图区按整数像素左移 (经暂存画布) 再补画右侧一条; 缩放, 改尺寸, 换主题, 量程变了才整张重画。数据缓冲是对齐的数组, 超过上限 1.25 倍时一次丢掉前段 (摊还 O(1)), 不是严格的环形缓冲。入场动画没做。
- 柱状 / 组合图没做, 所以 GitHub 走势 (`/github/trend`) 还没画; 热力格做了 (每级一条 path)。CF 额度是额度条 + 按 worker 堆叠条, 没有按 worker 的时序堆叠图; `CfUsage` 类型协议包里没有, Web 端按 `server/src/api-cf.ts` 本地定义。
- 资源页是主机列表 + 详情 (字段按单位分组成几张时序图, 不共享十字线), 不是 `AutoGrid` 卡片网格。调色板对比度算法已移植, 但还没和安卓用同一组测试数据核对。
- 总览进页时发一次 `overview` 帧, 不随 `ev` 增量更新。
