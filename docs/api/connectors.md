# HX-AIOA API v1: 来源适配器 (#3)

接入总览见 [接口总览](v1.md) §3。适配器实现在 `server/src/adapters/`, 来源类型登记在 `SOURCE_TYPE_INFOS`, 类型定义在 `protocol/src/v1/source.ts`。

## 1. 接入步骤

1. `POST /api/v1/sources` `{ "name": "家里 Kuma", "type": "uptime-kuma", "key": {} }`, 返回里的 `key.key` 与 `key.webhookUrls` 只显示一次。
2. 把对应的 `webhookUrls[adapter]` 填到外部系统, 末尾加 `?key=<key.key>` (GitHub 改用 Secret 验签)。
3. 事件立刻出现在动态里, 客户端不需要任何改动; 需要调整提醒方式时在规则里按来源 (`sources: ["uptime-kuma"]` 或来源 id) 写规则。

所有适配器产出的都是 §4 的 `event`, 关键字段:

| 适配器 | subject | dedupeKey (覆盖更新) | groupKey (根因分组) | 恢复 |
| --- | --- | --- | --- | --- |
| `github` | `github:<owner/repo>` | `pr:<repo>#<n>`, `issue:<repo>#<n>`, `ci:<repo>:<workflow>:<branch>` | CI 为 `ci:<repo>` | PR / issue 关闭, CI 成功 |
| `uptime-kuma` | 监控名 | `kuma:<monitor.id>` | `host:<主机名>` | `heartbeat.status = 1` |
| `beszel` | 系统名 | `beszel:<系统>:<指标>` | `host:<系统>` | 标题含 up / below / resolved |
| `healthchecks` | 检查名 | `hc:<code>` | 无 | `status` 不是 down |
| `generic` | 映射或事件本身 | 映射或事件本身 | 映射或事件本身 | 映射的 status 含 resolve / ok / up |

同一台主机的多个监控用 `host:<主机名>` 分组, 机器掉线引起的一串告警只为第一条提醒。

## 2. 各适配器

### generic

- 来源配置了 `mapping` 时按映射取字段: 值是模板, `{{a.b.0.c}}` 取 JSON 路径, 可混合文字, 如 `"[{{host}}] {{msg}}"`。可映射: `title`, `summary`, `severity`, `status`, `url`, `subject`, `dedupeKey`, `groupKey`, `channel`, `priority`。
- `severity` 归一 (`severityFromText`): 含 err / crit / fatal / down / fail 为 `critical`, 含 warn 为 `warning`, 含 info / ok / up / resolv / success 为 `info`。
- 没有映射时: 请求体本身是 §3.3 的事件格式 (有 `data` 或 `title`) 就按事件处理; 否则标题为来源名, 摘要为请求体前 500 字。
- 请求体可以是 JSON, 表单 (`application/x-www-form-urlencoded`), 或为空 (此时取 query 参数, 去掉 `key`)。

### github

仓库 Settings → Webhooks: Payload URL 填 `webhookUrls.github`, Content type 选 `application/json` (表单的 `payload=` 也支持), Secret 填 `webhookSecret`。支持 `ping`, `push`, `pull_request`, `issues`, `issue_comment` (仅新建), `workflow_run` (仅完成), `release` (仅发布), `star`, 其它事件转成一条 info 事件。PR 被请求 review 与 CI 失败为 `need_me`。

### uptime-kuma

通知类型选 Webhook, Post URL 填 `webhookUrls["uptime-kuma"]?key=...`, 请求体选 `application/json`。`heartbeat.status`: 0 掉线 (critical), 1 恢复, 2 等待 (warning, 默认规则聚合 5 分钟), 3 维护 (info)。测试通知 (没有 heartbeat) 入库为一条 info。

### beszel

Beszel 通过 shoutrrr 发通知, 地址写 `generic://<域名>/api/v1/hooks/beszel/<keyId>?key=hxk_...` (shoutrrr 默认 https, 未被它识别的 query 会原样带给目标地址, 以实际版本为准)。请求体为 `{ "title", "message" }`, 从标题里取系统名 (`... on <系统>` 或 `Connection to <系统> is down`) 与指标 (cpu / memory / disk / bandwidth / temperature / load / gpu)。

### healthchecks

集成选 Webhook, down 与 up 都填 `webhookUrls.healthchecks?key=...`, 方法 POST, Content-Type `application/json`, 请求体模板:

```json
{ "name": "$NAME", "status": "$STATUS", "code": "$CODE", "tags": "$TAGS", "now": "$NOW" }
```

也兼容同样字段的表单或 query。

### netdata / prometheus (指标)

只产出 `metric`, 字段统一换成标准名 (`cpu`, `mem`, `disk`, `load` 等), 工作台组件按 `subject + field` 绑定, 与来源无关, 详见 [工作台接口](spaces.md) §1。

- netdata: 拉取 `/api/v1/allmetrics?format=json`, 整体 POST 一次; subject 取来源上配置的 `subject`。
- prometheus: 拉取 `/api/v1/query`, `itemsPath` 填 `data.result`, 每条 POST 一次; 字段取 `field` 标签 (用 `label_replace` 打上), subject 取 `subject` 标签或 `instance`。
- beszel 指标: 拉取 PocketBase `/api/collections/systems/records`, `itemsPath` 填 `items`, 带 `info` 的条目转成指标, 告警通知仍按上文转成事件。

## 3. 拉取式来源

不能主动推送, 或只在内网可达的来源 (邮件 API, 内网探针, 需要令牌的接口) 由家里的机器定时拉取, 每个条目原样 POST 给某个 webhook 适配器, 映射规则仍在服务端统一维护。约定类型 `PullConfig` / `PullJob`:

```json
{
  "server": "https://aioa.example.com",
  "keyId": "k_...",
  "keyEnv": "AIOA_KEY",
  "jobs": [
    { "id": "gh-notify", "url": "https://api.github.com/notifications", "everySec": 300, "headers": { "Authorization": "Bearer $GITHUB_TOKEN" }, "adapter": "generic" }
  ]
}
```

- `everySec` 最小 60; `headers` 的值里 `$变量名` 从环境变量展开, 密钥不写进配置; `itemsPath` 取响应里的数组 (如 `data.items`), 不写表示整个响应是一条。
- 运行: `AIOA_PULL_CONFIG=pull.json AIOA_KEY=hxk_... GITHUB_TOKEN=... node tools/puller.mjs`。未变化的条目不重复推送, 服务端也会按 `dedupeKey` 覆盖。
- 配合来源的 `mapping` 使用: 为拉取任务建一个 `type: "pull"` 的来源并配置映射, 用它的 key 运行 puller。

## 4. 新增一种来源

1. 在 `server/src/adapters/` 写一个 `Adapter` 函数: 输入请求体, 请求头, 来源信息, 输出 `EventInput[]` (或错误文字)。
2. 在 `HOOK_ADAPTERS` (protocol) 与 `ADAPTERS`, `SOURCE_TYPE_INFOS` (server) 登记: 名称, 图标, 接入说明, 默认规则。
3. 在 `server/test/adapters.test.ts` 补一条样例。客户端通过 `GET /api/v1/source-types` 自动看到新类型。
