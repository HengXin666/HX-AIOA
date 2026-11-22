# 安卓通知: 自有图标与按内容分样式 - Intent

## TaskIntentDraft

- Requested outcome: 系统通知小图标换成自有单色矢量图标, 按消息, GitHub, 告警, Agent 待确认, 报告, 更新, 常驻连接分渠道与样式
- Goal: 系统通知小图标换成自有单色矢量图标, 按消息, GitHub, 告警, Agent 待确认, 报告, 更新, 常驻连接分渠道与样式
- Success evidence:
- :app:compileReleaseKotlin 通过; 图标预览人工确认可辨认
- Stop condition: Stop when success evidence is satisfied or a blocker/risk requires pause.
- Non-goals:
- 不改设置页布局与页面导航; 不改协议与服务端
- Scope: client/android 通知相关: link/Notifier, link/EventNotifier, link/NotifyKit, link/Channels, link/AgentActionReceiver, update/Installer, update/InstallPermission, res/drawable/ic_stat_*
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
- client/android
- Owners:
- none
- Invariants:
- :link 进程不加载 Compose 类; 老渠道 message_v2 保留
- Non-goals:
- 不改设置页布局与页面导航; 不改协议与服务端

These records are Method Pack drafts / hints, not authoritative runtime decisions.
