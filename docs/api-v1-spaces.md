# HX-AIOA API v1: 工作台 (已实现单账号版本)

从 [api-v1.md](api-v1.md) §7 拆出, 类型真源为 `protocol/src/v1/space.ts`。

## 工作台 (#5)

Space → Panel → Item → Bind。组件只订阅 `subject + field`, 不自己拉数据。

```json
{
  "id": "servers", "title": "服务器", "icon": "server",
  "panels": [
    {
      "id": "nas", "title": "NAS", "size": "m", "refresh": { "mode": "push" },
      "items": [
        { "id": "cpu", "type": "value", "title": "CPU", "icon": "cpu", "bind": [ { "subject": "nas-01", "field": "cpu" } ], "props": { "unit": "%" } },
        { "id": "cpu-trend", "type": "sparkline", "bind": [ { "subject": "nas-01", "field": "cpu", "range": "1h" } ] },
        { "id": "disk", "type": "ring", "bind": [ { "subject": "nas-01", "field": "disk" } ], "props": { "max": 100 } },
        { "id": "restart", "type": "button", "title": "重启容器", "action": { "agent": "dsh", "command": "restart", "args": { "name": "web" }, "danger": true } }
      ]
    },
    { "id": "daily", "title": "日报", "refresh": { "mode": "interval", "everySec": 3600 }, "items": [ { "id": "r", "type": "report", "props": { "latest": true } } ] }
  ]
}
```

- 组件类型: `value` (数值), `sparkline` (迷你折线), `line` (折线图), `ring` (环形), `status_grid` (状态网格), `task_card` (任务卡), `list` (动态列表), `report` (报告), `button` (按钮)。前五种必须有 `bind`; `button` 必须有 `action`。
- `refresh`: `{ "mode": "push" }` 或 `{ "mode": "interval", "everySec": >=60 }`; 超过 2 倍周期没有新数据, 客户端显示 "已过期" 与最后更新时间。
- 限制: 20 个面板, 每面板 24 个组件, 整体 32KB; `id` 只能含字母数字与 `_ . : -`。
- 按钮点击: 客户端以 `act` 发给 Agent, `taskId` 为 `button:<spaceId>:<itemId>`, `kind: "reply"`, `text` 为 `command`; `danger` 为真时先弹确认并带 `confirm: true`。

接口:

- `GET /api/v1/spaces` (访问令牌) → `{ "spaces": [Space & { "state": SpaceState }] }`
- `POST /api/v1/spaces` (访问令牌或 `spaces:write` key): 请求体为 `Space`, 或 `{ "space": Space, "to": ["group:family"] }` 下发给他人 (仅 admin/owner 的 key)。同 id 覆盖。校验失败返回 400, `errors` 列出所有问题: `{ "error": "布局校验失败", "code": "bad_request", "errors": ["panels[0].items[1]: sparkline 需要至少一个 bind"] }`。成功返回 `{ "ok": true, "delivered": 1 }`, 在线设备收到 `space_update` 帧。
- `DELETE /api/v1/spaces/{id}` (访问令牌)
- `PUT /api/v1/spaces/{id}/state` `{ "hidden": false, "hiddenPanels": ["daily"], "order": ["nas", "daily"] }`: 用户自己的显示状态, 与布局分开存, Agent 重新下发布局不会覆盖。
