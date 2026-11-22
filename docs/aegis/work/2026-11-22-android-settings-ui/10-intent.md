# 安卓我的与设置页 UI 重做 - Intent

## TaskIntentDraft

- Requested outcome: 功能不变, 我的与设置页改为分组列表加独立子页的极简风格, 返回键逐级回退, 平板两栏
- Goal: 功能不变, 我的与设置页改为分组列表加独立子页的极简风格, 返回键逐级回退, 平板两栏
- Success evidence:
- :app:compileReleaseKotlin 通过; docs/settings-map.md 列出旧位置到新位置全部功能
- Stop condition: Stop when success evidence is satisfied or a blocker/risk requires pause.
- Non-goals:
- 不改 Notifier, GitHub 与总览页, SettingsModel
- Scope: client/android/app/src/main/java/com/hengxin/aioa/ui (MePage, SettingsScreen, Shell, MainActivity, settings 子包)
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
- SettingsModel 只在进入相关子页时创建, 不提前拉起代理内核
- Non-goals:
- 不改 Notifier, GitHub 与总览页, SettingsModel

These records are Method Pack drafts / hints, not authoritative runtime decisions.
