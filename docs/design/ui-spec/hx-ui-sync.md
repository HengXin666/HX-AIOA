# 安卓端如何跟随 HX-UI (#121)

## 现状 (2026-11-27 查)

- 安卓 (Compose) 没有用到 HX-UI 的任何东西。令牌来自本仓库 `design/tokens.json`, 由 `tools/gen-tokens.mjs` 生成 `GeneratedTokens.kt` 和 `client/web/src/tokens.css`; 组件是 `client/android/ui` 里自己写的。
- 网页端 `client/web` 也没装 `@hx/ui`, 只用了 `lucide-static`。
- HX-UI 2.2.0 是 React 库 (shadcn + Tailwind v4), 令牌写在 `next/src/styles/theme.css` 的 CSS 变量里, 没有导出机器可读的令牌文件。

所以两边现在 "看着像" 全靠手抄, HX-UI 一改, 安卓不会知道。

## 能共享什么

| 层 | 能否直接共享 | 做法 |
| --- | --- | --- |
| 令牌 (颜色, 圆角, 字号, 间距, 阴影, 动效时长与缓动) | 能 | HX-UI 发布时导出 `dist/tokens.json`, 安卓按锁定的版本生成 Kotlin |
| 图标 | 能 | 两边都是 Lucide; 图标名单与版本放进同一个 json |
| 主题 / 皮肤 (亮暗, 强调色, 自定义皮肤) | 能 | 皮肤也是令牌的一组覆盖, 一起导出 |
| 组件 (Button, Dialog, Sidebar...) | 不能直接用 | React 组件跑不到 Compose 里; 安卓按同名同变体实现, 用清单约束 |
| 交互规范 (容器, 返回, 动效时机) | 能 | 写在 HX-UI 文档里, 两端遵守 |

## 方案

1. **HX-UI 导出两个文件** (加进 `npm run build:lib`):
   - `dist/tokens.json`: 从 `theme.css` 解析, 亮 / 暗两套 + 各皮肤覆盖, OKLCH 同时给出 sRGB 十六进制; 圆角, 字号, 间距, 动效; Lucide 版本。
   - `dist/components.json`: 每个基础件的名字, 变体, 尺寸 (从 cva 定义里抽), 例 `button: { variant: [default, destructive, outline, secondary, ghost, link], size: [default, xs, sm, lg, icon...] }`。
2. **AIOA 锁定版本**: `design/hx-ui.lock` 写 HX-UI 的 release 版本和文件哈希; `tools/gen-tokens.mjs` 改为读锁定版本的 `tokens.json` 生成 `GeneratedTokens.kt` 与网页 CSS。本仓库 `design/tokens.json` 只留 AIOA 自己的覆盖 (如有)。
3. **组件对照**: 安卓组件库按 `components.json` 实现同名同变体 (`HxButton(variant = Outline, size = Sm)`), `docs/design/hx-ui-map.md` 列对照表。CI 比对: HX-UI 新增变体安卓没实现 → 警告; 删除或改名 → 报错。
4. **升级流程**: 改 `hx-ui.lock` → 跑生成 → CI 比对 → 画廊截图对比 → 合并。HX-UI 按语义化版本: 改令牌值是小版本, 删 / 改名组件或变体是大版本; 安卓锁版本, 不会被动跟着坏。
5. **ChatGPT 深色做成 HX-UI 的皮肤**, 不在 AIOA 里单独写死, 网页和安卓用同一套。

## 兼容性结论

- 令牌层: 完全可自动跟随, 改一处两端同时变。
- 组件层: 只能 "同名同变体 + CI 比对" 保证不漂移, 视觉细节靠画廊截图对比; 不存在 Compose 直接跑 React 组件的办法 (WebView 套壳会丢掉原生手势与性能, 不采用)。
