# v1 服务端: 统一事件, 来源接入, Agent 交互, 规则引擎 - Intent

- 目标: 在 core-proto 草案基础上实现协议与服务端 (#2 #3 #4 #6), protocol/ 仍为唯一真源。
- 范围: protocol, server, tools (puller.mjs, e2e-v1.mjs), docs/api-v1*.md, protocol/README.md。
- 非目标: 多账号 (#5), 频道订阅, 工作台, 探针管理接口, Web 与安卓适配 (client/ 不改)。
- 兼容边界: 旧 /ws, /api/send, /api/messages 与 AUTH_TOKEN 继续可用; 旧 msg 表首次启动并入 ev 表, seq 不变。
- 不变量: 只用休眠 WebSocket; metric 不逐点落库 (每 subject 最新值最多每 5 分钟写一次); 进度最多每 30 秒写一次; 规则与设置各占一个 KV 键。
- 关键决定:
  - 单 Hub 承载母号的收件箱, key, 来源; 结构按 "每用户 DO + 目录 DO" 拆分预留, #5 落地时迁移。
  - 覆盖更新 = 删旧行插新行, id 不变 seq 变新, 客户端只需 "同 id 覆盖"。
  - 根因与同类合并从最近 300 条收件箱推算, 不额外写表。
  - 单个 DO 闹钟由 Timers 复用: 兜底推送, 聚合窗口, 确认超时。
  - webhook 签名密钥由 TOKEN_SECRET 派生, 不落库。
