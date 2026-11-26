# 规则引擎 (#6)

从 [v1 契约](v1.md) 第 5 节拆出。

规则在服务端 (Hub) 执行, 客户端只负责编辑和展示。对每条进入收件箱的事件 (含任务里程碑), 依次匹配: 用户规则 (按列表顺序, 第一条命中生效) → 来源规则 → 内置默认规则, 然后依次做降噪 (见下)。

```json
{
  "id": "r_ab12",
  "name": "夜里 NAS 告警不响",
  "enabled": true,
  "when": { "sources": ["src_*"], "subjects": ["nas-*"], "channels": ["nas/*"], "kinds": ["event"], "severities": ["warning", "normal"], "statuses": ["firing"], "priorities": ["happening"], "keywords": ["温度"] },
  "window": { "start": "23:00", "end": "08:00", "days": "all" },
  "action": "silent",
  "channels": ["ws"],
  "aggregateSec": 300,
  "bypassQuiet": false
}
```

- `when` 中各字段都是 "任一匹配", 字段之间是 "并且", 不写表示不限。`sources` 匹配来源 id, 名字或类型 (如 `github`), `subjects`, `channels`, `sources` 支持 `*` 通配; `statuses` 匹配 `firing|resolved|ongoing`; `keywords` 在标题和摘要中查找 (不区分大小写)。
- `window`: 规则只在该时间窗内生效; `start > end` 表示跨午夜; `days`: `all` | `weekday` | `weekend`。时区取设置 `tz` (默认 `Asia/Shanghai`)。
- `action`:

| action | 含义 | 实时 WS | 兜底推送 | 进总览 |
| --- | --- | --- | --- | --- |
| `alert` | 强提醒 (客户端响铃 / 横幅) | 是 | 是 | 是 |
| `push` | 普通推送 | 是 | 是 | 是 |
| `silent` | 静默入库 | 是 (不提醒) | 否 | 是 |
| `digest` | 只进摘要 | 是 (不提醒) | 否 | 只进 `worth_reading` |
| `aggregate` | 聚合后推送: 窗口 (`aggregateSec`, 默认 300) 内的同类事件静默入库, 窗口结束推一条 "N 条 xxx" | 是 (不提醒) | 窗口结束时 | 是 |
| `drop` | 不推但保留 (可在时间线 "已过滤" 中查到) | 否 | 否 | 否 |

- `channels` (投递渠道): `ws` (长连接), `mipush`, `wxpusher`, `next_open` (不实时推, 下次打开 / 重连时补拉看到)。不写时 `alert`/`push` 为 `["ws","mipush","wxpusher"]`。兜底推送仅在安卓设备 1.5 秒内未 ack 时发出。
- 降噪, 只作用于 `alert`/`push`, 降级后动作为 `silent` 且 `route.reason` 写明原因:
  1. 免打扰: 设置里的 `quiet` (同 `window` 格式) 时段内降级, 除非规则 `bypassQuiet: true`。
  2. 关联事件只推根因: 同 `groupKey` 已有未闭环的根因 (6 小时内) 时降级, `route.merged` 为组内已有条数。
  3. 同一事件更新: 覆盖同 `id` 时, 严重程度没有升级且状态没变则降级。
  4. 短时间同类合并: 60 秒内已有同类 (`来源|subject|标题`) 事件时降级, `route.merged` 为条数。
- 聚合 (`aggregate`): 窗口键为 `规则|来源|subject`, 窗口内原始事件照常静默入库, 窗口结束推一条来源为 `system` 的汇总事件 `"N 条: 标题"` (`route.merged = N`, 免打扰时段内也只静默)。

内置默认规则 (开箱可用, `builtin: true`, 不能修改, 可以用自己的规则覆盖):

| id | 条件 | 动作 |
| --- | --- | --- |
| `builtin:resolved` | `kind = event` 且 `status = resolved` | `silent` |
| `builtin:need-me` | `priority = need_me` | `alert` |
| `builtin:reading` | `priority = worth_reading` | `digest` |
| `builtin:default` | 其余 | `push` |

接口 (访问令牌): `GET /api/v1/rules` → `{ "rules": [Rule] }` (含内置, 内置在最后); `POST /api/v1/rules` (新建, 追加到末尾) → `Rule`; `PUT /api/v1/rules/{id}` 整体替换; `DELETE /api/v1/rules/{id}`; `PUT /api/v1/rules/order` `{ "ids": [...] }` 调整顺序 (必须包含全部自定义规则); `POST /api/v1/rules/test` 请求体同 §3.3 的事件, 返回 `{ "route": RouteInfo }`, 只试算不入库, 供手机上编辑规则时预览。规则匹配结果写在事件的 `route` 中。用户规则最多 100 条, 存为一个键, 改一次只写一行。

来源类型自带的默认规则 (可被用户规则覆盖): GitHub `info` 级动态只进摘要; Uptime Kuma `warning` (等待中) 聚合 5 分钟。
