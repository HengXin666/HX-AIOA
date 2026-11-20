# 推送链路可行性验证 - Intent

## TaskIntentDraft

- Requested outcome: 搭建服务端, Web 端, 安卓端骨架, 实测推送延迟与后台功耗
- Goal: 搭建服务端, Web 端, 安卓端骨架, 实测推送延迟与后台功耗
- Success evidence:
- 真机实测: 送达延迟 p95 不超过 3 秒; 锁屏 8 小时耗电接近零; :link 进程内存占用极小
- Stop condition: 真机数据达标则进入 Agent 层; 不达标则评估接入 MiPush 为主通道
- Non-goals:
- Agent 层, 微页面组件, 多用户
- Scope: protocol, server, client/web, client/android, tools
- Change kinds:
- new-feature
- Risk hints:
- 国产 ROM 后台限制, 大陆访问 Cloudflare 的延迟

## BaselineReadSetHint

- none

## BaselineUsageDraft

- Required baseline refs:
- none
- Acknowledged before plan:
- none
- Cited in plan:
- none
- Missing refs:
- none
- Advisory decision: continue

## ImpactStatementDraft

- Compatibility boundary: Compatibility boundary not yet refined.
- Affected layers:
- none
- Owners:
- server/src/hub.ts 为消息唯一真源
- Invariants:
- 消息 seq 单调递增, 客户端按 since 补拉不丢消息
- Non-goals:
- Agent 层, 微页面组件, 多用户

These records are Method Pack drafts / hints, not authoritative runtime decisions.
