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

验证: 仓库根目录 `npm run typecheck` 与 `npm run build -w client/web`。

## 目录

| 路径 | 内容 |
| --- | --- |
| `src/core/` | 与界面无关: 登录与带凭证请求 (`auth.ts`), 长连接 (`link.ts`), 会话数据 (`chats.ts`), 头像, 版本检查 |
| `src/app/` | 路由 (hash) 与 React hooks (`useSyncExternalStore` 订阅 core) |
| `src/ui/` | 页面与组件, 只用 `@hx/ui/ui/*` 按路径引, 颜色只用令牌类 |
| `public/_headers` | 静态资源缓存头 |

## 规则

- 不写定时 `fetch`; 数据靠长连接推送帧失效后再拉 (会话列表带 ETag)。
- 链接一律 `target="_blank" rel="noopener noreferrer"`; HTML 卡片放沙箱 iframe, 不给脚本。
- 不引 `@hx/ui` 根入口和 `effects` `text` `backgrounds` `stage`; `Spin` 用 `mode="fixed"`。
- 布局三档: `>=1280px` 侧栏 + 列表 + 详情, `720-1279px` 图标栏, `<720px` 单栏 + 底栏 (手机浏览器)。

## 部署

不用单独部署: `deploy.yml` 在 `wrangler deploy` 前构建 `client/web` 并把 `dist/` 拷进 `server/public/`, 和服务端同源同版本。页面地址就是服务端域名, 路由形如 `/#/c/<群>`。
