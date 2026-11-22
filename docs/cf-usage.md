# CF 额度页

App "我的 → 系统 → CF 额度" (仅主账号)。服务端 `GET /api/v1/cf/usage` 查 CF GraphQL 分析接口, 结果在内存缓存 10 分钟。

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
