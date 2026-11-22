# CF 部署的探针面板调研 (#11)

调研时间: 2026-11-22。关联 #9, #2。

结论先行: **保留懒更新协议的骨架 (挂空闲休眠 WS, 有人看才推, 指标不落库), 调整探针形态与少量协议字段。** 在所有调研到的 CF 探针里, 当前做法是唯一能做到 "无人看时 0 消息, 0 行写入, 0 DO 时长" 的; 缺的是探针派发相关的能力 (独立令牌, 远程配置, 升级) 和服务端离线判断。具体改动见第 6 节。

## 1. 免费额度基线

以下数字均来自 Cloudflare 官方定价页, 每天 00:00 UTC 重置, 超出后对应操作直接报错 (不扣费)。

| 资源 | 免费额度 | 计量要点 |
| --- | --- | --- |
| Workers 请求 | 100,000 / 天 | WebSocket 只在 Upgrade 时算 1 次; 经 Worker 转发的 WS 消息不算; 静态资源请求免费不限量 |
| DO 请求 | 100,000 / 天 | HTTP, RPC, alarm 各算 1 次; **入站 WS 消息按 20:1 折算**; 出站消息不计 |
| DO 时长 | 13,000 GB-s / 天 | 按 128 MB 计费, 即约 104,000 秒 (28.9 小时) 墙钟; 可休眠的空闲 DO 不计时长 |
| DO SQLite 行写入 | 100,000 / 天 | `put()`, `delete()`, `setAlarm()` 各算行写入 |
| D1 行写入 | 100,000 / 天 | INSERT/UPDATE/DELETE 按行计, 带索引的列每次再多 1 行 |
| KV 写入 | 1,000 / 天 | 读 100,000 / 天 |
| Queues | 10,000 操作 / 天 | 一条消息约 3 次操作 |

来源:
- Workers 定价: https://developers.cloudflare.com/workers/platform/pricing/
- DO 定价: https://developers.cloudflare.com/durable-objects/platform/pricing/
- D1 定价: https://developers.cloudflare.com/d1/platform/pricing/
- DO 生命周期 (空闲 10 秒后休眠, 可休眠的空闲态不计费): https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/

两个对本项目关键但容易误读的点:

1. **一个 DO 全天不休眠 = 86,400 s × 0.125 GB = 10,800 GB-s, 占免费时长的 83%。** 只能有一个这样的 DO, 第二个就超。
2. **`setWebSocketAutoResponse` 的 ping/pong**: 官方定价页只写明 "不计墙钟时长"; 是否计入请求数官方页面没有写死, CF 员工在 Discord 说明消息不投递给脚本, 不计请求也不计时长 (https://www.answeroverflow.com/m/1268650024032796765)。下文按 "不计" 估算, 同时给出 "按 20:1 计" 的最坏值。

## 2. 调研对象一览

| 项目 | 部署 | 存储 | 实时通道 | 探针 | 链接 |
| --- | --- | --- | --- | --- | --- |
| CF-Server-Monitor (huilang-me) | Worker + DO + D1 | D1 (按周轮换历史表) | DO + WS 推前端 | Go 单文件 (cfsm-agent) | https://github.com/huilang-me/CF-Server-Monitor |
| cf-vps-monitor (kadidalax) | Worker + DO | **Supabase Postgres** (仓库描述仍写 D1, README 已改) | DO + WS | Go | https://github.com/kadidalax/cf-vps-monitor |
| K-UI-workers | 单 Worker + DO + D1 | D1 | DO (VpsPresence, DashboardHub) | Shell/安装组件 | https://github.com/a6216abcd/K-UI-workers |
| NIE-SLA | Worker + DO + D1 + R2 | D1 (配置/聚合) + R2 (高频历史) | DO (遥测缓冲, 实时流) | Rust | https://github.com/3257085208/NIE-SLA |
| Pantaw | Worker + D1 + KV | D1 | 无推送, 前端轮询 | Go | https://github.com/fadlee/pantaw |
| CF-Server-Monitor-Pro | Worker + D1 | D1 | 前端 AJAX 轮询 | Shell/PowerShell | https://github.com/a63414262/CF-Server-Monitor-Pro |
| UptimeFlare | Worker Cron + D1 | D1 (2026-01 由 KV 迁来) | 无, 状态页拉取 | 无探针, CF 侧主动拨测 | https://github.com/lyc8503/UptimeFlare |
| cf-workers-status-page | Worker Cron + KV | KV | 无 | 无探针 | https://github.com/eidam/cf-workers-status-page |
| Komari (对照, 自建) | Go 服务端 | 自带时序存储 | WS | Go | https://github.com/komari-monitor/komari |
| Nezha (对照, 自建) | Go 服务端 | SQLite | gRPC 双向流 | Go | https://nezha.wiki/en_US/guide/architecture.html |
| Beszel (对照, 自建) | PocketBase | SQLite | 前端 SSE | Go | https://github.com/henrygd/beszel |

## 3. 逐个分析

### 3.1 CF-Server-Monitor (最接近本项目, 重点)

README: https://github.com/huilang-me/CF-Server-Monitor/blob/main/README.md
API: https://github.com/huilang-me/CF-Server-Monitor/blob/main/API.md
探针: https://github.com/huilang-me/cfsm-agent

架构与数据流:
- Agent `POST /update` 或 `wss://.../update` → Worker 校验 → DO (MetricsBroadcaster) 转发给前端订阅 → 按节流写 D1。
- 两个 Cron: 每分钟检测离线与资源告警, 每小时做历史表轮换与到期检测。
- 前端 `/api/ws` 用休眠 API; **Agent 的 `/update` WSS 故意用标准 WebSocket API (非休眠)**, 理由是避免高频消息表现为休眠唤醒。代价是 "只要 Agent 长连接存在, DO 会保持非休眠状态并产生 duration" (API.md 原文)。为此 2.8.4 加了 "WSS 开启时段", 非时段改走 POST, 并在后台展示 DO 用量。

上报频率与懒更新:
- 默认 POST 间隔 60 秒 (可选 30/60/120/180)。
- WSS 模式: 服务端在 ack 里下发 `nextWssReportAfterMs`, **有前端订阅时用 `wss_report_interval` (默认 2 秒, 1 到 5 秒), 无人看时退到 `report_interval` 且不低于 60 秒**。这是 "有人看才高频" 的懒更新, 但无人看时仍是每分钟 1 条。
- 高频包只带 CPU, 内存, 网速等轻量字段; 磁盘, GPU, 连接数等仍按 `report_interval` 刷新。
- 前端全量订阅按 250ms 窗口合并推送 (HTTP 上报最长 5 秒)。

存储与降采样:
- `metrics_history` 每台机器每 `report_interval` 最多写 1 行 (POST 只写本次最新样本, WSS 首条立即写, 之后按间隔节流)。
- 历史表每周日 00:00 UTC 轮换, 查询跨周时 `UNION ALL` 旧表; 7 天图表。
- 降采样在读侧: `ROW_NUMBER() OVER (PARTITION BY ts/interval)` 取每窗口第一条, 点数由 `long_history_points` (60 到 240) 决定。不存聚合表。

额度 (作者口径: 60 秒约 60 台, 120 秒翻倍):
- 每台每天写入 ≥ 1,440 行 (60 秒), 加上索引行与 servers 状态更新, 实际每台 1,440 到 2,880 行。D1 写入上限 → **约 35 到 69 台**。
- POST 模式另有 Workers 请求 1,440 / 台 / 天 → 69 台 (还要扣除前端访问)。
- WSS 模式 Workers 请求可忽略, 但一个 DO 全天不休眠固定吃 10,800 GB-s; 有人看时 2 秒一条, 每台每看 1 小时 = 1,800 条 = 90 DO 请求。

探针派发:
- 一行安装脚本 (curl | sh, 也有 PowerShell, Docker), 后台按系统生成命令。
- **鉴权是全局 `API_SECRET` + 服务器 ID**, 不是每台独立令牌; 改密钥需要所有机器重装。2.8.7 加了自动发现建号。
- 远程配置: 采集/上报间隔, Ping 节点, 网卡, 流量重置日等由 Agent 带 `config_md5` 上报, 服务端在 POST 响应或 WSS `config` 帧里下发差异, 最短每分钟处理一次。
- 升级: `-auto_update=1` 时每 6 小时查 GitHub release, 校验 `checksums.txt` 的 SHA-256 后自替换; 默认关闭。升级不由面板驱动。

告警: 全部在服务端 (Cron 每分钟检测离线与资源阈值), 渠道有 Telegram, 企业微信, 飞书, Bark, SMTP, Webhook 等。

### 3.2 cf-vps-monitor

README: https://github.com/kadidalax/cf-vps-monitor/blob/main/README.md

- Worker 承载前端, API, 实时连接与 Cron; DO 协调实时状态; **历史与配置存 Supabase Postgres** (早期版本是 D1, 已迁走, 说明 D1 写入额度是瓶颈之一)。
- 懒更新: "有实时观看者时 Agent 约 3 秒采集并上报; 无人查看时约 120 秒采样并批量上报"。作者明确写 "不能仅凭 Worker 请求量保证免费运行 50 台", 后台提供容量估算。
- 鉴权: 每节点 Token, 后台可轮换; 同机可装多实例 (独立 instance-id)。
- 升级: Agent 不自动更新, 用后台生成的新命令原地重装。
- 告警: 服务端, Telegram/SMTP/Webhook。

### 3.3 K-UI-workers

README: https://github.com/a6216abcd/K-UI-workers/blob/main/README.md

- 单 Worker: Assets 托管前端与 VPS 安装文件, D1 存配置/流量/探针数据, 两个 DO: `VpsPresence` (Agent 在线状态) 与 `DashboardHub` (前端广播)。
- README 写有 "观众频率自适应" 与 "即时配置刷新", 未给具体间隔与额度数据 (未读源码确认)。
- Cron 每 5 分钟检查离线节点; 告警服务端 (Telegram)。
- 本质是代理节点管理面板, 探针只是附属能力, 有远程部署节点能力 (主控式)。

### 3.4 NIE-SLA

README: https://github.com/3257085208/NIE-SLA/blob/main/README.md

- 单 Worker: 静态前端 + 后台 + API + D1 + R2 + DO + 每分钟 Cron。
- 分层存储: **DO 做遥测缓冲, 高频历史批量写 R2, D1 只放配置, 当前状态与 SLA 聚合**。这是调研里唯一明确把高频数据移出 D1 的 CF 方案。代价: R2 即使只用免费额度也必须绑定付款方式。
- 派发做得最完整: **每节点独立 Token, 安装票据一次性有效**; Agent 安装与更新从部署者自己的 Worker `/bin` 下载 (构建时从 GitHub Release 拉取并校验 `SHA256SUMS`), VPS 上不查 GitHub API; 安装与更新校验版本, manifest 与二进制 SHA-256。
- 固定诊断动作 (不接受任意命令), Rust Agent, 主遥测服务低权限运行。
- 告警服务端, Telegram 与邮件。

### 3.5 Pantaw

README: https://github.com/fadlee/pantaw/blob/main/README.md

- Go Agent `POST /api/v1/ingest` (Bearer agent_token) → Hono Worker → D1 批量 INSERT (`WITHOUT ROWID`); KV 只用于鉴权限流, 热路径 0 次 KV 写。
- 无推送, 前端轮询。默认间隔 30 秒 (最低 5 秒), 每 Token 限流 15 次/分钟。
- 额度: 30 秒时每台 2,880 Workers 请求 + ≥ 2,880 行 D1 写入 → **约 34 台**。
- 每系统可多 Token, 支持轮换; 安装脚本校验 SHA-256, systemd 服务; 升级靠重跑安装脚本。
- 告警: Cron 评估 "持续超限" 后触发 Webhook (服务端)。
- UI 与架构参考 Beszel, 把 SSH 隧道换成 HTTPS ingest, PocketBase 换成 D1。

### 3.6 CF-Server-Monitor-Pro

README: https://github.com/a63414262/CF-Server-Monitor-Pro

- Worker + D1, 前端 AJAX 局部轮询, 无 DO。
- 作者原话: "10 台 VPS 以下可以使用 cf 版本轻量部署, 10 台以上建议使用 docker 部署"。说明 "每次上报都写 D1 + 轮询" 的朴素做法在免费额度下很快撞线。

### 3.7 UptimeFlare 与 cf-workers-status-page (拨测类, 非探针)

- UptimeFlare: Cron 每分钟从 CF 节点拨测 HTTP/TCP, "最多 50 个检查 1 分钟间隔", 2026-01 从 KV 迁到 D1 以解决性能问题, 90 天可用率历史。https://github.com/lyc8503/UptimeFlare
- cf-workers-status-page: Cron + KV, README 明说免费 KV 写入只够 2 分钟间隔 (1 分钟 = 1,440 次 > 1,000 次/天), 告警受子请求上限限制最多 25 个监控。https://github.com/eidam/cf-workers-status-page
- 对本项目的启示: "服务端定时轮询 + 每次落库" 在免费层撑不了高频; 离线判断天然在服务端。

### 3.8 自建对照: Komari, Nezha, Beszel

Komari (https://www.komari.wiki/en/dev/agent, https://www.komari.wiki/en/dev/api):
- Agent v2 用 JSON-RPC 2.0 走 WebSocket `/api/clients/v2/rpc?token=`, **默认 1 秒上报**, 每 30 秒 WS Ping; WS 不通时退 POST + `agent.pull` 长轮询 (25 秒)。
- 基础信息 (CPU 型号, OS 等) 与实时指标分开, 基础信息 5 分钟一次。
- 每节点 token, 自动发现, 默认开启自动更新, 有 Web SSH 与远程执行 (主控式)。
- 告警在服务端: 离线通知带宽限期 (默认 5 分钟), 负载通知按 "间隔内超阈值时间占比"。
- 若照搬到 DO: 1 秒 = 86,400 条/台/天 = 4,320 DO 请求 → **约 23 台**。

Nezha (https://nezha.wiki/en_US/configuration/agent.html):
- Agent 与 Dashboard 之间 gRPC 双向流, `report_delay` 1 到 4 秒; 连接密钥绑定用户 + 每 Agent UUID。
- 默认自动更新, 可关闭; 配置可在后台修改后下发。
- 告警服务端, AlertSentinel 每 3 秒评估一次规则 (https://deepwiki.com/nezhahq/nezha/5.3-monitoring-and-alerts)。
- 照搬到 DO: 3 秒 = 28,800 条/台/天 = 1,440 请求 → 约 69 台。

Beszel (https://beszel.dev/guide/security, https://deepwiki.com/henrygd/beszel/4-data-storage-and-aggregation):
- Hub (PocketBase) 每 60 秒向 Agent 取一次数据; 连接两种方向: Hub 经 SSH 连 Agent, 或 Agent 主动 WS 连 Hub `/api/beszel/agent-connect`。浏览器经 SSE 收实时更新。
- **降采样做得最规范**: 1m 记录保留 1 小时 → 10m (保留 12 小时) → 20m (24 小时) → 120m (7 天) → 480m (30 天), 每 10 分钟由 Cron 生成更长粒度, 每小时删旧记录。
- 每台每天行数约 1,440 + 144 + 72 + 12 + 3 ≈ 1,671 行; 照搬到 D1 → **约 59 台**。
- 告警服务端。通用 token 可让 Agent 免预先登记接入。

## 4. 横向对比

### 4.1 实时性与懒更新

| 项目 | 通道 | 有人看 | 无人看 | 是否 "无人看就停" |
| --- | --- | --- | --- | --- |
| CF-Server-Monitor | Agent WSS (非休眠) / POST | 2 秒 (1 到 5) | ≥ 60 秒 | 否 |
| cf-vps-monitor | WS / HTTP | 约 3 秒 | 约 120 秒批量 | 否 |
| K-UI-workers | WS | 自适应 (未公开数值) | 未公开 | 未知 |
| NIE-SLA | WSS / HTTPS | 未公开 | 持续上报进 DO 缓冲 | 否 |
| Pantaw, CFSM-Pro | HTTP POST + 前端轮询 | 30 秒 / 固定 | 同左 | 否 |
| Komari / Nezha / Beszel | WS / gRPC / SSH | 1 秒 / 1 到 4 秒 / 60 秒 | 同左 | 否 |
| **HX-AIOA 当前** | 休眠 WS + demand | 2 秒 | **0 条消息** | **是** |

调研范围内没有发现其它 "无人看就完全停推" 的 CF 探针。原因很直接: 它们都要持续落库画历史曲线, 所以必须持续上报; 本项目把历史放到探针本地, 才能做到 0 上报。

### 4.2 存储与每天写入量 (每台机器)

| 项目 | 历史存哪 | 降采样 | 每台每天写入 |
| --- | --- | --- | --- |
| CF-Server-Monitor | D1, 周表轮换, 7 天 | 读时窗口取首条 | 1,440 到 2,880 行 (60 秒) |
| cf-vps-monitor | Supabase | 未公开 | 不占 CF 额度 |
| NIE-SLA | R2 (高频) + D1 (聚合) | DO 缓冲后批量 | D1 少量; R2 A 类操作 |
| Pantaw | D1 | 未公开 | ≥ 2,880 行 (30 秒) |
| Beszel (若移植 D1) | SQLite | 1m→10m→20m→120m→480m | ≈ 1,671 行 |
| **HX-AIOA 当前** | 探针本地内存, 24 小时 × 每分钟 1 点 | 无 | **0 行** |

### 4.3 撞线台数 (免费层, 只算指标链路)

假设: 写入每行不含索引额外行; 前端访问另计; HX 的 "看" 是 App 资源页或总览页在前台。

| 方案 | 瓶颈 | 每台每天消耗 | 撞线台数 |
| --- | --- | --- | --- |
| CFSM POST 60 秒 | D1 写入 / Workers 请求 | 1,440 行 + 1,440 请求 | 约 60 (作者口径), 算上索引行约 35 |
| CFSM WSS 60 秒 | D1 写入; DO 时长固定 10,800 GB-s | 1,440 行 | 约 69, 但无余量给第二个常驻 DO |
| Pantaw 30 秒 | 两者同时 | 2,880 行 + 2,880 请求 | 约 34 |
| Komari 式 1 秒上报进 DO | DO 请求 | 4,320 请求 | 约 23 |
| Nezha 式 3 秒上报进 DO | DO 请求 | 1,440 请求 | 约 69 |
| Beszel 式落 D1 | D1 写入 | 1,671 行 | 约 59 |
| **HX 当前, 无人看** | 无 | 0 (ping 若计费则 144 请求) | 不撞线 (最坏约 690) |
| **HX 当前, 有人看 H 小时/天** | DO 请求 | 90 × H 请求 | N × H ≤ 约 1,000 |

HX 有人看时的推算:
- 2 秒一点 → 每台每小时 1,800 条入站消息 → 按 20:1 折算 90 DO 请求。留 10,000 给消息链路, 约束为 `90 × N × H ≤ 90,000`, 即 **N × H ≤ 1,000**: 20 台每天看 1 小时完全无压力; 42 台全天 24 小时开着总览页才撞线。
- DO 时长: Hub 用休眠 API, 2 秒间隔的空档里处于 "可休眠空闲态", 官方明确此状态不计时长, 只计每条消息的处理时间。按每条 5 ms 估算, `N × H = 1,000` 时约 1,800,000 条 × 0.005 s × 0.125 GB ≈ 1,125 GB-s, 远低于 13,000。
- SQLite 写入: 指标 0 行; 只有探针告警走 `/api/send` 写消息表, 每条告警约 1 到 2 行。
- 空闲 ping: 探针每 30 秒发一次 `ping` (tools/probe.mjs `PING_MS`), 由自动应答处理。按官方口径不计时长; 若最坏按入站消息计, 每台每天 2,880 条 = 144 请求 → 约 690 台才撞线。

### 4.4 探针派发

| 项目 | 安装 | 鉴权 | 远程配置 | 升级 |
| --- | --- | --- | --- | --- |
| CF-Server-Monitor | curl \| sh, PowerShell, Docker | 全局 API_SECRET + ID | 有, md5 协商, POST 响应或 WSS `config` 帧 | 可选, 每 6 小时查 GitHub, SHA-256 校验 |
| cf-vps-monitor | 后台生成命令, 多实例 | 每节点 Token, 可轮换 | 有 | 手动重装 |
| NIE-SLA | 后台生成命令 | 每节点 Token + 一次性安装票据 | 有 | 从自己 Worker `/bin` 下载, SHA-256 + manifest |
| Pantaw | 交互/非交互脚本, Docker | 每系统多 Token, 可轮换 | 无 (环境变量) | 重跑脚本 |
| Komari | 脚本, 自动发现 | 每节点 token | 有 | 默认自动 |
| Nezha | 脚本 | 用户密钥 + UUID | 后台下发 | 默认自动, 可关 |
| **HX 当前** | 手动 `node tools/probe.mjs`, 需 Node 22 | **与 App 共用 AUTH_TOKEN** | 无 (环境变量) | 无 |

### 4.5 告警

调研到的 CF 项目和三个自建对照 **全部在服务端判断**, 至少离线告警必须在服务端 (探针自己无法报告自己死了)。资源阈值告警也都在服务端用 Cron 或定时任务评估, 代价是必须持续上报数据。

HX 当前: 资源阈值在探针本地判断 (每分钟采样, 连续 3 次超限发一条, 恢复发一条), 走 `/api/send`。优点是无需持续上报; **缺口是没有离线告警**。

## 5. 当前设计的对照评估

代码依据: `server/src/metrics.ts` (MetricRouter), `server/src/hub.ts` (Hub), `tools/probe.mjs`, `docs/metrics.md`。

做对的地方 (应保留):
1. **探针连接用休眠 API + 自动应答 ping**。CF-Server-Monitor 的 Agent 用非休眠 API, 固定吃掉 83% 的 DO 时长; 本项目空闲时 0 时长。
2. **demand 只在需求变化时下发** (`rebalance` 里 `sameSet` 判断), 不会因 watch 抖动刷消息。
3. **指标不落库**, 符合 AGENTS.md "SQLite 每天 10 万行写入是瓶颈, 瞬时状态不落库"。调研中所有落库方案都在 35 到 70 台撞线, 本项目没有这个上限。
4. **历史放探针本地, 打开时一次性补发**。网络中断期间探针本地仍在记点, 恢复后历史无缺口; CF-Server-Monitor 这类服务端落库方案在 Agent 断网期间是空白。
5. **单 Hub DO**。所有探针与客户端在一个 DO 里, `rebalance` 是内存操作, 不需要跨 DO 协调; 免费层下 DO 时长只有一个对象在算。

不足 (需要调整):
1. **探针与 App 共用一个 `AUTH_TOKEN`** (`server/src/auth.ts` 只比较一个 expected)。探针机器被入侵等于消息全量泄露, 且可以冒充任意设备发消息。所有做 "派发" 的项目 (cf-vps-monitor, NIE-SLA, Pantaw, Komari) 都是每节点独立令牌。这是做探针派发前必须先解决的问题。
2. **没有离线告警**。探针死机或断网时只是从 `probes` 列表消失, 不会产生消息。
3. **探针形态重**: 依赖 Node 22, 常驻内存远大于 Go/Rust 单文件 (调研中 CF 系探针全部是 Go 或 Rust 单文件, Pantaw 写明 <10MB 二进制, <15MB 内存)。不利于路由器, NAS 等小设备。
4. **没有远程配置与升级**: 阈值, 采样间隔全靠环境变量, 改一次要登机器。
5. **一个间隔打天下**: 总览页只要 CPU 一个数, 却和资源详情页一样 2 秒推全部指标。
6. **探针死机后历史随之丢失**: 恰好是最想看 "死前发生了什么" 的时候看不到。这是 "零写入" 的代价, 可以用很低的写入量补上 (见 6.5)。
7. Hub 只有一个 alarm, 已被兜底推送占用 (`armFallback`); 加离线检测需要复用这个 alarm。

## 6. 决定与具体改动

**决定: 保留懒更新协议, 不改为 "持续上报 + 落库"; 在其上做 6 项调整。** 理由: 第 4.3 节的数字表明持续上报方案在免费层只能撑几十台, 而本项目的使用场景 (个人, 偶尔打开看) 与 "有人看才推" 完全吻合; 缺的都是可以增量补上的能力, 不需要推翻协议。

### 6.1 每探针独立令牌 (优先级最高, 先于派发)

- Hub 的 DO SQLite 新增 `probes` 表: `subject`, `token_hash` (SHA-256), `created_at`, `revoked`。只在登记, 吊销时写入, 每天写入量可忽略。
- 新令牌只允许: 以 `probe-<subject>` 身份连 `/ws`, 发 `offer` (只能是自己的 subject), `metric`, 告警消息; **不下发 welcome 之后的消息历史, 不能 watch, 不能调用 `/api/history`**。
- App 端 "我的 → 探针" 页生成令牌与安装命令, 令牌只在生成时显示一次。
- 鉴权在 Worker 入口完成, 未授权请求不进 DO (与 CF-Server-Monitor 的做法一致), 避免被刷 DO 请求。

### 6.2 服务端离线告警

- `webSocketClose` / `webSocketError` 时, 若关闭的是探针, 记下 `subject → 断开时间` 并保证 alarm 在 "断开时间 + 宽限期" 前触发 (宽限期建议 3 分钟, Komari 默认 5 分钟)。
- alarm 触发时: 若该探针已重连则丢弃; 否则以 `probe-<subject>` 为 `src` 发一条离线消息, 复用现有消息与兜底推送链路。重连时若之前发过离线消息, 再发一条恢复消息。
- 半开连接 (对端掉电, 没有关闭帧): 用 `ctx.getWebSocketAutoResponseTimestamp(ws)` 读每个探针最后一次 ping 时间 (https://developers.cloudflare.com/durable-objects/api/state/)。只在 "存在在线探针" 时安排一个低频巡检 alarm (建议 5 分钟), 超过 3 个 ping 周期无应答视为离线并主动关闭。成本: 每天最多 288 次 alarm 调用 + 288 行 `setAlarm` 写入, 约占免费写入的 0.3%。
- alarm 多路复用: 用 DO 存储保存 "兜底推送到期时间" 与 "离线检测到期时间", alarm 设为两者最小值, 触发时分别处理。断开时间放内存即可, 休眠丢失时退化为由巡检兜住。
- 此项需要在实机上验证: CF 边缘在对端掉电后多久触发 `webSocketClose`, 以及自动应答时间戳在休眠期间是否持续更新。验证前不应宣称离线告警的延迟上限。

### 6.3 远程配置帧 (新增 `config`, Hub → 探针)

- 探针连接后 Hub 立即下发一次, 配置变更时再下发:
  `{t:"config", rev, idleSampleMs, historyPoints, alerts:[{key, limit, times}], target?:{version, url, sha256}}`
- 配置存 DO SQLite, 只在用户修改时写入。探针收到后应用并写本地文件, 断线重连时带 `rev`, Hub 只在 `rev` 不一致时下发 (同 CF-Server-Monitor 的 md5 协商, 但不需要轮询, 因为长连接已在)。
- 阈值告警仍在探针本地判断 (保持 "不持续上报" 的前提), 但阈值从环境变量改为由面板下发。
- 协议改动按 AGENTS.md 先改 `protocol/`, 再同步 server, web, 安卓 `Frames.kt`。

### 6.4 分级 demand (调整 `watch` / `demand`)

- `watch` 增加可选级别: `{t:"watch", subjects, level?: "overview" | "detail"}`, 默认 `detail`。
- Hub 对每个主体取所有观看者中最细的级别, `demand` 改为按主体给间隔:
  `{t:"demand", items:[{subject, intervalMs, fields?}]}`。建议 overview 10 秒只推 `cpu`, `mem`; detail 2 秒推全部。
- 效果: 总览页消息量降为 1/5, 上面 `N × H ≤ 1,000` 的约束在总览场景放宽到 `N × H ≤ 5,000`。
- 兼容: 过渡期 Hub 同时接受旧的 `watch` (视为 detail)。

### 6.5 可选的服务端粗粒度历史 (默认关闭)

- 目的: 探针死机后仍能看到 "死前" 的曲线, 并让离线告警消息附带最后状态。
- 做法: 探针每小时在既有连接上发一条 `{t:"rollup", subject, hour, points:[12 个 5 分钟 {avg, max}]}`, Hub 以 "主体 + 小时" 为主键写 **1 行** (JSON 列), 保留 7 天, 由离线巡检 alarm 顺带删除过期行。
- 成本: 每台每天 24 行写入 + 24 行删除 = 48 行 → 约 2,000 台才撞线; 入站消息每台每天 24 条, 可忽略。对比 Beszel 式逐层聚合 (1,671 行/台/天), 写入量低约 35 倍。
- 打开详情页时: 探针在线则仍用探针本地高精度历史; 探针离线才读这张表。
- 若后续确定不需要 "死后可查", 此项不做, 协议不受影响。

### 6.6 探针形态: 单文件二进制 + 面板驱动升级

- 形态: 改为 Go 静态单文件 (gopsutil 采集, 交叉编译 linux amd64/arm64/armv7/mips, darwin, windows)。调研中 CF 系探针 (cfsm-agent, cf-vps-monitor, Pantaw) 与 Komari, Nezha, Beszel 均为 Go, NIE-SLA 为 Rust; Go 的交叉编译与 gopsutil 生态最成熟。`tools/probe.mjs` 保留为协议参考实现与本地联调工具。语言选型属于新组件, 应单开 issue 并按 Aegis 流程立项, 本调研只给建议。
- 安装: Worker 静态资源托管 `install.sh` / `install.ps1` (静态资源请求免费不限量), App 生成一行命令, 内含服务端地址与 6.1 的独立令牌; 注册 systemd / OpenRC / launchd 服务, 支持非 root。
- 升级: **由面板驱动**, 不让每台机器定时查 GitHub。GitHub Release 发布二进制与 `SHA256SUMS`; 用户在 App 点 "升级" 后, Hub 在 `config.target` 里下发版本, 下载地址与 SHA-256; 探针下载, 校验, 替换后退出, 由服务管理器拉起。参考 NIE-SLA 的 manifest + SHA-256 链与 cfsm-agent 的 "校验失败继续跑旧版"。
- `offer` 帧增加 `version`, `os`, `arch`, 供 App 展示与升级判断。
- 不做 Web SSH, 远程命令等主控能力 (与 CF-Server-Monitor, NIE-SLA 的安全取向一致), 探针始终只出站。
  - 2026-11-23 更新: 应需求加了经探针中转的终端, 默认关闭, 需 key 权限 + 主机本地开关 + 每次输入密码, 探针仍只出站, 见 docs/terminal.md。

### 6.7 不建议采纳的做法

- 不建议 Agent 长连接用非休眠 WebSocket (CF-Server-Monitor 的做法): 一个对象就占 83% 免费时长, 且与 AGENTS.md "禁止 `ws.accept()`" 冲突。
- 不建议引入 D1, KV, R2, Queues: 单 Hub DO 的 SQLite 已够用; KV 写入额度 (1,000/天) 和 Queues (10,000 操作/天) 都比 DO 更紧; R2 需要绑定付款方式。
- 不建议把资源阈值告警搬到服务端: 那要求持续上报, 直接丢掉懒更新的全部收益。只有离线判断必须在服务端。
- 不建议 Cron 轮询: 本项目已有长连接与 alarm, Cron 每分钟一次就是每天 1,440 次 Worker 调用且大多空转。

## 7. 改动后的额度复核 (免费层, 单 Hub DO)

| 项目 | 每台每天 | 100 台时 | 占免费额度 |
| --- | --- | --- | --- |
| 空闲 ping (若计费) | 144 DO 请求 | 14,400 | 14.4% (官方口径为 0) |
| 观看: 总览 1 小时 + 详情 0.5 小时 | 18 + 45 = 63 请求 | 6,300 | 6.3% |
| 可选 rollup | 1.2 请求 + 48 行 | 120 请求 + 4,800 行 | 0.1% + 4.8% |
| 离线巡检 alarm | 与台数无关, ≤ 288 请求 + 288 行 | 同左 | 0.3% |
| 告警消息 | 视情况, 每条 1 到 2 行 | 少量 | 可忽略 |
| DO 时长 | 每条消息处理时间 | 远低于 1,000 GB-s | < 8% |

按此估算, 100 台机器, 每天正常查看, 指标链路合计不超过免费额度的约 25% (按 ping 计费的最坏口径), 剩余额度留给消息与 Agent 双工主链路。

## 8. 待验证事项

1. 自动应答 ping 是否计入 DO 请求数 (官方只写不计时长)。可在部署后用 GraphQL `durableObjectsPeriodicGroups` 对比空闲一天的入站消息与计费请求。
2. 对端掉电后 `webSocketClose` 的触发延迟, 以及 `getWebSocketAutoResponseTimestamp` 在休眠期间的行为 (决定 6.2 的宽限期与巡检周期)。
3. 2 秒推送时每条消息的实际处理时长 (决定 DO 时长估算中 5 ms 的假设)。
4. K-UI-workers 的 "观众频率自适应" 具体实现与间隔, 本次只读了 README, 未读源码。
5. cf-vps-monitor 迁出 D1 的具体原因, README 未说明, 上文 "D1 写入是瓶颈之一" 是推断。
