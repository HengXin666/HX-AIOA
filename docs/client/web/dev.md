# Web 端开发

架构与取舍见 [web-arch.md](../../design/web-arch.md) (#155)。本文只讲怎么跑, 怎么改。

## 本地开发

```bash
npm install                      # 仓库根目录; HX-UI 从 GitHub Release 装 tgz, .npmrc 已放行
cd client/web
cp .env.example .env.local       # VITE_AIOA_DEV_SERVER 填一个服务端, /api 由 Vite 转发过去 (含 WebSocket)
npm run dev
```

登录用安卓 App 上的同一个账号。访问令牌只在内存, 刷新令牌存 `localStorage` (`aioa.refresh`), 包里不再有任何令牌。

验证: 仓库根目录 `npm run typecheck` 与 `npm run build -w client/web`。构建输出里看首屏 `index-*.js` (gzip ≤160 KB) 与 `index-*.css` (gzip ≤30 KB); 其余页面都是懒加载块。

## 目录

| 路径 | 内容 |
| --- | --- |
| `src/core/auth.ts` | 登录, 带凭证请求 (`api` / `apiRaw` / `fill`); 刷新令牌跨标签用 `navigator.locks` 串行, 别的标签退出时这里也退出 |
| `src/core/link.ts` | 页面侧连接, 对外 `frames` `states` `state` `start` `stop` `seen` `send` `write`; 按能力选 SharedWorker / 主标签 / 本页 |
| `src/core/link-hub.ts` | 唯一那条 WebSocket: 重连退避, 心跳, 向页面要令牌, 各页 `watch` 取并集, 新标签补发 `welcome` `probes` `hosts` `agents` `online` `presence` |
| `src/core/link-worker.ts` | SharedWorker 入口 (Vite `new SharedWorker(new URL(...), { type: "module" })`), 用标签锁发现标签关闭 |
| `src/core/link-proto.ts` | 页面与持有方之间的消息类型 |
| `src/core/cache.ts` | IndexedDB 键值缓存 (库 `aioa`), 退出登录清空 |
| `src/core/chats.ts` | 会话列表与消息: 先读缓存再带 ETag 校验, 每群缓存最近 100 条; 未读数, 已读上报, 置顶 / 免打扰 |
| `src/core/outbox.ts` | 待确认的发送: 超时或没连上标失败, 可重试 |
| `src/core/presence.ts` | `presence` 帧 (在听 / 在输入), 按 `until` 本地过期 |
| `src/core/resources.ts` | `probes` / `hosts` / `metric` 帧, 每个主体一个 `SeriesBuffer`, `watch` 整体替换 |
| `src/core/files.ts` | 附件: 换带票据的下载地址, 新标签打开 (先开空白页再导到 blob) |
| `src/charts/` | 图表层: `palette.ts` (令牌取色 + 对比度补正, 移植自安卓 `ChartPalette.kt`), `source.ts` (时序缓冲), `timechart.ts` (Canvas 时序图), `TimeSeries.tsx` (图例与悬停提示), `svg.tsx` (迷你图, 环, 热力格) |
| `src/app/` | hash 路由 (`router.ts`) 与 hooks (`useSyncExternalStore` 订阅 core) |
| `src/ui/` | 页面与组件: `Shell` (三档布局, 快捷键), `ChatList`, `Conversation` + `Composer` + `MessageItem` / `MessageParts`, `Inspector` (群资料), `CommandPalette`, `Overview`, `Settings`, `resources/` (主机, CF 额度, GitHub) |
| `public/` | `_headers` 缓存头, `manifest.webmanifest` 与图标 (PWA) |

## 路由

`#/` 消息, `#/c/<群>` 会话, `#/overview` 总览, `#/res` (`/h/<主体>`, `/cf`, `/gh/<owner/name>`) 资源, `#/settings` 设置。总览, 资源, 设置, 命令面板, 群资料都用 `React.lazy` 分包。

## 规则

- 不写定时 `fetch`; 数据靠长连接推送帧失效后再拉 (会话列表带 ETag)。资源页的 CF 额度与 GitHub 进页时取一次。
- 连接只经过 `link`: 不要在页面里另开 WebSocket。指标只在页面可见时 `resources.watch([主体])`, 离开或隐藏立即 `watch([])`。
- 链接一律 `target="_blank" rel="noopener noreferrer"`; HTML 卡片放沙箱 iframe, 不给脚本。
- 不引 `@hx/ui` 根入口和 `effects` `text` `backgrounds` `stage`; 这些目录在 `index.css` 里也排除了扫描。`Spin` 用 `mode="fixed"`。
- 颜色只用令牌类; 画布颜色从 `charts/palette.ts` 取 (读 `--chart-1..5` 等 CSS 变量)。悬停才出现的按钮加 `[@media(hover:none)]:opacity-100`, 触屏常显。
- 布局三档: `>=1280px` 侧栏 + 列表 + 详情 (+ 320px 群资料栏), `720-1279px` 图标栏 + 右抽屉, `<720px` 单栏 + 底栏 + 底部抽屉。
- 快捷键: `Ctrl/⌘+K` 命令面板, `Alt+↑/↓` 切会话, `Esc` 关群资料。
- Web Push 与 Service Worker 在 `src/core/push.ts` 与 `public/sw.js` (W3); `main.tsx` 与设置页用 `import.meta.glob` 按需加载, 文件不在时不显示 "通知" 一组。

## 部署

不用单独部署: `deploy.yml` 在 `wrangler deploy` 前构建 `client/web` 并把 `dist/` 拷进 `server/public/`, 和服务端同源同版本。页面地址就是服务端域名, 路由形如 `/#/c/<群>`。
