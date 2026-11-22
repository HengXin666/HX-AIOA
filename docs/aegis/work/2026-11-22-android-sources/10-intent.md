# 安卓 我的 → 数据源 页面 - Intent

## TaskIntentDraft

- Requested outcome: 安卓 app 可以添加, 查看, 删除数据源, 新建后按类型给出接入步骤 (GitHub 分步 + 复制按钮 + 连通检测)。
- Goal: 安卓 app 可以添加, 查看, 删除数据源, 新建后按类型给出接入步骤 (GitHub 分步 + 复制按钮 + 连通检测)。
- Success evidence:
- :app:compileReleaseKotlin 通过
- Stop condition: Stop when success evidence is satisfied or a blocker/risk requires pause.
- Non-goals:
- 不改服务端与协议; 不新增重新生成 key 的接口, 用删掉重建代替
- Scope: client/android/app: ui/Sources*.kt, ui/SourceSetupPage.kt, net/Api.kt, MePage, Shell, ChatModel, Constants
- Change kinds:
- none
- Risk hints:
- none

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
- none
- Non-goals:
- 不改服务端与协议; 不新增重新生成 key 的接口, 用删掉重建代替

These records are Method Pack drafts / hints, not authoritative runtime decisions.
