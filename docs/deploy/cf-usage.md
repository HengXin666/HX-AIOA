# CF 额度页

App "我的 → 系统 → CF 额度" (仅主账号)。服务端 `GET /api/v1/cf/usage` 查 CF GraphQL 分析接口, 结果缓存 10 分钟: 内存一层, Cache API 一层 (isolate 回收后还在, 不占 DO 写入)。App 端把上次的结果存在本机, 打开立刻显示, 后台刷新后替换。

| 项 | 免费额度 / 天 | 数据来源 |
|---|---|---|
| Worker 请求 | 100,000 | `workersInvocationsAdaptive.sum.requests` |
| DO 请求 | 100,000 | `durableObjectsInvocationsAdaptiveGroups.sum.requests` (原始计数; 计费时 WS 入站消息按 20:1 折算, 所以实际计费更少) |
| DO 时长 | 13,000 GB-s | `durableObjectsPeriodicGroups.sum.duration` |
| 行写入 | 100,000 | `durableObjectsPeriodicGroups.sum.rowsWritten` |
| 行读取 | 5,000,000 | `durableObjectsPeriodicGroups.sum.rowsRead` |

额度每天 UTC 0 点重置, 见 https://developers.cloudflare.com/durable-objects/platform/pricing/ 。

## 配置

1. CF 控制台 → 我的个人资料 → API 令牌 → 创建自定义令牌, 权限只给 `账户 · Account Analytics · 读取`。
2. `gh secret set CF_ANALYTICS_TOKEN`
3. `gh workflow run deploy.yml`: 部署时同步为 Worker 密钥 `CF_API_TOKEN`, 账号 id 从已有的 `CLOUDFLARE_ACCOUNT_ID` 同步为 `CF_ACCOUNT_ID`。

## 提醒

cron 每 30 分钟检查一次, 任一项用到 80% 时在 "CF 额度" 群发一条, 每天 (UTC) 最多一条。没配置 token 时不检查。

## 存储

点进额度页最下面的 "存储": 整个账号的 DO 存储 (`durableObjectsStorageGroups.max.storedBytes`, CF 统计有延迟) 对照免费 5 GB, 以及主 Hub 数据库当前大小 (`sql.databaseSize`, 实时)。存储不按天重置。

## CF 总览 (根域名 → 服务)

`GET /api/v1/cf/zones?range=1d|7d` (owner), 服务端缓存 5 分钟 (同上两层), CF GraphQL 限额是每用户 5 分钟 300 次。每个根域名另给 `workerReq` (近 24 小时按主机名归到 Worker 的请求) 和整体的 `workerDayLimit`, App 显示该站点占每日 Worker 额度的比例。

- 根域名列表: REST `/zones` (token 需 区域 · Analytics · 读取, 资源选全部区域)。
- 每个根域名: 请求, 流量, 缓存命中, 拦截威胁, 状态码分布, 来源国家; 1d 按小时 (httpRequests1hGroups), 7d 按天 (httpRequests1dGroups)。
- 主机名排行: httpRequestsAdaptiveGroups 按 clientRequestHTTPHost, 固定近 24 小时。
- 主机名对应的服务: Worker 路由/自定义域名, Pages 项目域名; 需要 token 另加 账户 · Workers 脚本 · 读取 和 账户 · Cloudflare Pages · 读取, 没有时不标。
- Worker: workersInvocationsAdaptive 按脚本, 请求/错误/子请求/CPU 中位与 P99 (微秒)。

## CF 存储 (R2 / KV / D1)

`GET /api/v1/cf/storage` (owner), 缓存 5 分钟。每类存储的总大小与本期用量对照免费额度 (R2 操作按月, KV/D1 按天, UTC), 并列出每个桶/命名空间/数据库。R2 用 r2StorageAdaptiveGroups / r2OperationsAdaptiveGroups, KV 用 kvStorageAdaptiveGroups / kvOperationsAdaptiveGroups, D1 大小来自 REST `/d1/database` 的 file_size, 用量来自 d1AnalyticsAdaptiveGroups。token 需 Workers R2 存储 / KV 存储 / D1 读取。
