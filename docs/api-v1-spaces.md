# HX-AIOA API v1: 工作台 (已实现单账号版本)

从 [api-v1.md](api-v1.md) §7 拆出, 类型真源为 `protocol/src/v1/space.ts` (schema 与校验), `protocol/src/v1/space-layout.ts` (显示状态, 排序, 尺寸, 当前值), `protocol/src/v1/metric-fields.ts` (标准指标字段与来源别名)。

## 1. 声明格式 (#5)

Space → Panel → Item → Bind。每个组件 = 类型 + 数据绑定 + 显示参数, 整份是 JSON, 由服务端下发。组件只订阅 `subject + field`, 不自己拉数据。

```json
{
  "id": "servers", "title": "服务器", "icon": "server",
  "panels": [
    {
      "id": "nas", "title": "NAS", "size": "m", "refresh": { "mode": "push" },
      "items": [
        { "id": "cpu", "type": "value", "title": "CPU", "icon": "cpu", "bind": [ { "subject": "nas-01", "field": "cpu" } ], "props": { "unit": "%" } },
        { "id": "cpu-trend", "type": "sparkline", "question": "CPU 在升还是降?", "bind": [ { "subject": "nas-01", "field": "cpu", "range": "1h" } ] },
        { "id": "disk", "type": "ring", "question": "磁盘还够不够?", "bind": [ { "subject": "nas-01", "field": "disk", "source": "beszel" } ], "props": { "max": 100, "warn": 80, "crit": 90 } },
        { "id": "restart", "type": "button", "title": "重启容器", "action": { "agent": "dsh", "command": "restart", "args": { "name": "web" }, "danger": true } }
      ]
    },
    { "id": "daily", "title": "日报", "size": "l", "refresh": { "mode": "interval", "everySec": 3600 }, "items": [ { "id": "r", "type": "report", "props": { "latest": true } } ] }
  ]
}
```

### 组件分类 (`CATEGORY_OF`)

| 分类 | 类型 | 绑定 | 说明 |
| --- | --- | --- | --- |
| 指标 | `value` 数值, `sparkline` 迷你趋势, `line` 折线, `ring` 环形 | 必须 | `props`: `unit`, `warn`, `crit`, `max`, `label` |
| 状态 | `status_grid` 在线 / 健康 | 必须 | 无阈值时按在线语义 (>0 在线, 0 离线); 有 `warn`/`crit` 时按健康级别着色 |
| 列表 | `list` 动态, `task_card` 任务 | 可选 | 省略时 subject 为 `*`; `props.limit` |
| 交互 | `chat` Agent 对话, `approval` 待批准 | 可选 | `chat`: bind 任务 id 或 `props.agent`, 显示最近对话并可追问 (`ask`); `approval`: bind Agent id, 只列等待确认的任务 |
| 动作 | `button` 按钮 | 无 | 必须有 `action` |
| 阅读 | `report` 报告 | 可选 | 显示最新一篇报告摘要 |
| 列表 | `todo` 待办 | 必须 | `bind[0].subject` 是群 channel (field 随意, 约定写 `todos`); 未完成按优先级排, 勾选即完成, 点条目跳回来源消息; `props.limit` |

Web (`client/web/src/components/registry.ts`) 与安卓 (`client/android/ui/.../kit/SpaceItems.kt`) 实现同一组类型, 渲染同一份 JSON。

### 每个图表回答一个问题

`sparkline`, `line`, `ring` 必须有 `question` (1 到 120 字), 写明这个图回答什么, 如 "最近 10 分钟有没有尖峰?"。其他组件可选。两端都把它显示在标题下。

### 数据绑定与可替换的来源

`bind`: `{ "subject": 主机或对象, "field": 标准字段, "range"?: "10m", "source"?: "beszel" }`。

- `field` 用标准字段: `cpu`, `mem`, `disk`, `gpu` (百分比), `temp` (°C), `load`, `net` (MB/s), `up` (1 在线 / 0 离线)。其他名字原样通过。
- 服务端在入口把各来源的原生名字换成标准字段 (`normalizeMetricValues`), 所以同一个 CPU 组件可以由探针, Beszel, Netdata 或 Prometheus 供数, 换来源不改布局。
- `source` 只声明期望的采集器, 方便阅读与排查, 不参与匹配。
- `range`: 数字 + `s/m/h/d`, 其他格式校验失败。

| 来源 | 接入 | 原生名 → 标准字段 |
| --- | --- | --- |
| 探针 `tools/probe.mjs` | `offer` / `metric` 帧 | 已是标准名 |
| Beszel | puller 拉 `/api/collections/systems/records`, `itemsPath: "items"`, `adapter: "beszel"` | `info.cpu`→cpu, `mp`→mem, `dp`→disk, `dt`→temp, `l1`→load, `g`→gpu, `b`→net, `status`→up |
| Netdata | puller 拉 `/api/v1/allmetrics?format=json`, `adapter: "netdata"`, 来源上配 `subject` | `system.cpu` 维度和 (去掉 idle)→cpu, `system.ram` used 占比→mem, `system.load` load1→load, `disk_space._`→disk |
| Prometheus | puller 拉 `/api/v1/query?query=...`, `itemsPath: "data.result"`, `adapter: "prometheus"` | 优先取 `field` 标签, 否则 `node_load1`→load, `up`→up; subject 取 `subject` 标签或去掉端口的 `instance` |
| 脚本 | `POST /api/v1/events` `{ "kind": "metric", "subject": "nas-01", "data": { "values": { "cpu_percent": 12 } } }` | `cpu_percent`→cpu, `memory`→mem, `temperature`→temp 等通用别名 |

Prometheus 示例: 给 CPU 打上 `field` 标签后, 同一个 `{subject:"nas-01", field:"cpu"}` 组件即可使用:

```text
label_replace(100 - avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[1m])) * 100, "field", "cpu", "", "")
```

同一主体的不同字段可以来自不同来源 (如 CPU 来自 Beszel, 温度来自 Prometheus), 服务端按字段合并最新值。

### 刷新与限制

- `refresh`: `{ "mode": "push" }` 或 `{ "mode": "interval", "everySec": >=60 }`; 超过 2 倍周期没有新数据, 客户端显示 "已过期" 与最后更新时间。
- 限制: 20 个面板, 每面板 24 个组件, 整体 32KB; `id` 只能含字母数字与 `_ . : -`; 组件 id 在整个工作台内唯一。
- 按钮点击: 客户端以 `act` 发给 Agent, `taskId` 为 `button:<spaceId>:<itemId>`, `kind: "reply"`, `text` 为 `command`; `danger` 为真时先弹确认并带 `confirm: true`。

## 2. 布局: 多工作台, 排序, 尺寸

- 多个工作台并存, 客户端顶部切换 (最多 12 个)。
- 面板宽度按 4 列网格: `s`=1 列, `m`=2 列 (默认), `l`=3 列, `full`=整行; 中屏两列, 手机一列时客户端自动收拢。
- `panel.size` 是 Agent 给的默认值, 用户调整后存在显示状态 `state.sizes`, 优先生效。
- 排序存在 `state.order`, 未出现在其中的面板按布局原顺序接在后面; `state.hiddenPanels` 中的面板不显示。

## 3. 接口

- `GET /api/v1/spaces` (访问令牌) → `{ "spaces": [Space & { "state": SpaceState }] }`
- `POST /api/v1/spaces` (访问令牌或 `spaces:write` key): 请求体为 `Space`, 或 `{ "space": Space, "to": ["group:family"] }`。同 id 覆盖布局, 保留用户的显示状态。校验失败返回 400, `errors` 列出所有问题: `{ "error": "布局校验失败", "code": "bad_request", "errors": ["panels[0].items[1]: 图表 sparkline 需要 question, 写明它回答什么问题"] }`。成功返回 `{ "ok": true, "delivered": 1 }`, 在线设备收到 `space_update` 帧。
- `DELETE /api/v1/spaces/{id}` (访问令牌)
- `PUT /api/v1/spaces/{id}/state` `{ "hidden": false, "hiddenPanels": ["daily"], "order": ["nas", "daily"], "sizes": { "nas": "full" } }`: 只传要改的字段, `sizes` 与已有的按面板合并。面板 id 必须存在, 尺寸只能是 `s/m/l/full`, 否则 400。成功后其他在线设备收到 `space_update`。
- `GET /api/v1/spaces/{id}/data` → `{ "id", "generatedAt", "values": [{ "subject", "field", "value", "ts", "unit"? }], "events": [Envelope] }`: 服务端按绑定解析的当前值 (指标取各主体最新值, 列表与报告取最近事件), 客户端打开工作台时先用它填充, 之后由实时推送接管。
