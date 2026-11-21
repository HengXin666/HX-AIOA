# 核心协议与服务端: 多账号, 接入 key, 统一事件, 规则, Agent, 工作台 - Intent

## TaskIntentDraft

- Requested outcome: 协议 + 服务端 + Web 最小适配达到基础版, 覆盖 #2-#7 #9§6 #11 的核心能力
- Goal: 协议 + 服务端 + Web 最小适配达到基础版, 覆盖 #2-#7 #9§6 #11 的核心能力
- Success evidence:
- npm run typecheck + web build 通过; tools/e2e-v1.mjs 在 wrangler dev 下全部通过
- Stop condition: Stop when success evidence is satisfied or a blocker/risk requires pause.
- Non-goals:
- 安卓端适配 (另一个 agent 负责)
- Scope: protocol, server, client/web, tools, docs
- Change kinds:
- feature
- Risk hints:
- DO 免费额度每天 10 万行写入; 安卓端尚未适配 v1 协议

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

- Compatibility boundary: 旧 /ws, /api/send, /api/messages 与 AUTH_TOKEN 继续可用
- Affected layers:
- none
- Owners:
- none
- Invariants:
- metric 不逐条落库
- 只用休眠 WebSocket
- 管理员不能读子号内容
- Non-goals:
- 安卓端适配 (另一个 agent 负责)

These records are Method Pack drafts / hints, not authoritative runtime decisions.
