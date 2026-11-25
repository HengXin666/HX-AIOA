# HX-AIOA Agent 指南

本文件是所有 AI 编程 agent 在本仓库工作的统一规范, 也是作者其他项目的默认标准。

## 1. 项目定位

HX-AIOA (All In One App) 是一个个人用的随处可用对话入口: 把各类消息聚合到一个 app, 并能随时与 Agent 双工对话。

当前阶段: 验证消息推送的可行性。两条硬指标:

- 延迟: 服务端发出到终端展示, 最多 3 秒。
- 后台: 安卓后台驻留接近零耗电, 内存占用极小, 理想情况等价于只保留一条网络连接。

## 2. 目录与归属

| 目录 | 内容 | 技术栈 |
| --- | --- | --- |
| `protocol/` | 客户端与服务端共用的消息协议, 唯一真源 | TypeScript |
| `server/` | 部署在 Cloudflare 的服务端 | Workers + Durable Objects (SQLite, 休眠 WebSocket) |
| `client/web/` | Web 端 (也适配平板浏览器) | Vite + TypeScript |
| `client/android/` | 原生安卓端 | Kotlin + Jetpack Compose + OkHttp |
| `tools/` | 延迟压测等辅助脚本 | Node.js |
| `docs/aegis/` | Aegis 工作区记录 (计划, 证据, ADR) | Markdown |

协议改动必须先改 `protocol/`, 再同步 `server/`, `client/web/`, `client/android/` 中的对应实现 (安卓端在 `proto/Frames.kt`)。

## 3. 工作流程

- 以 Aegis 作为首要调度流程: 非平凡任务先对齐基线, 再写计划, 分切片执行, 完成前给出新鲜的验证证据。
- 记录写入 `docs/aegis/`, 用 `aegis-workspace.py` 管理, 不要手工改 `BASELINE-GOVERNANCE.md`。
- 改动保持最小且可验证, 不要新增没有证据支撑的目录, fallback 或兼容路径。
- 没有跑过验证命令, 不要声称 "完成" 或 "通过"。

## 4. 代码规范 (硬性)

1. 每个文件格式化后不超过 500 行, 超过就按职责拆分。
2. 禁止大段注释。只在必要处写一行简短注释, 解释 "为什么" 而不是 "做了什么"。
3. 所有面向人的文字使用中文: 注释, 文档, 日志, 报错信息, UI 文案, 提交说明。
4. 中文里的标点一律使用英文半角标点 (`,` `:` `;` `!` `?` `()` `""`), 唯一例外是句号使用 `。`。
5. 同一个字面量出现 3 次及以上, 提取为常量, 放进该模块的常量文件 (`constants.ts` / `Constants.kt`)。
6. 代码中禁止出现任何绝对路径, 包括拼接出来的绝对路径。
7. 密钥只放环境变量或 secret, 不进仓库。
8. 文档放进 `docs/` 对应子目录 (api, features, deploy, client, design), 新增时在 `docs/README.md` 登记一行; `docs/agent-guide.md` 地址已写进各 Agent, 不得移动。

## 5. 验证命令

```bash
npm install
npm run typecheck          # protocol + server + web
npm run build -w client/web
```

安卓端: 用 Android Studio 打开 `client/android/` 构建; CI 见 `.github/workflows/android.yml`, `docs/deploy/android-signing.md`, 更新与代理见 `docs/deploy/android-update-proxy.md`。加页面或页面间跳转时按 `docs/client/android-navigation.md` 处理返回键, 并更新其中的入口清单与 `TabNavTest`。

- 密钥, 令牌, 服务端地址不得写进 APK 或仓库, 仓库是公开的。

## 6. 性能约束 (修改推送链路时必读)

- 服务端只用 WebSocket Hibernation API (`ctx.acceptWebSocket`), 禁止 `ws.accept()`, 否则全程计费。
- 心跳用 `setWebSocketAutoResponse` 或 WebSocket 协议 ping, 不唤醒 Durable Object。
- 免费额度瓶颈是 SQLite 每天 10 万行写入: 只持久化真正的消息, 在线状态与输入中等瞬时状态不落库。
- 安卓长连接运行在独立的 `:link` 进程, 该进程不得加载任何 UI 或 Compose 类。
- 消息带递增序号 `seq`, 断线重连按序号补拉; 推送只负责唤醒, 消息以服务端为准。
