# 安卓基础版: 懒更新指标, 四栏导航, 外观设置, 探针告警 - Intent

## TaskIntentDraft

- Requested outcome: 一个有完整基础功能的版本: 探针实时指标 (有人看才推), 安卓总览/消息/资源/我的, 外观可自定义, 告警走消息
- Goal: 一个有完整基础功能的版本: 探针实时指标 (有人看才推), 安卓总览/消息/资源/我的, 外观可自定义, 告警走消息
- Success evidence:
- typecheck + web build 通过; wrangler dev 本地跑通探针 → 指标 → 告警; PR CI 编译安卓通过
- Stop condition: Stop when success evidence is satisfied or a blocker/risk requires pause.
- Non-goals:
- 探针派发, CF 探针面板调研 (#11)
- Scope: protocol, server, tools/probe.mjs, client/android (ui kit, gallery, app), CI
- Change kinds:
- feature
- Risk hints:
- 安卓整包只能在 CI 编译; 真机未验证

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
- none
- Invariants:
- 指标不写 SQLite
- 后台 :link 进程不参与指标
- Non-goals:
- 探针派发, CF 探针面板调研 (#11)

These records are Method Pack drafts / hints, not authoritative runtime decisions.
