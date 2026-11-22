# v1 服务端 - Evidence

2026-11-22, 分支 wt-proto-server, 均在本地新鲜运行。

| 命令 | 结果 |
| --- | --- |
| `npm install --no-audit --no-fund` | 通过 |
| `npm run typecheck` (protocol + server + web) | 通过, 0 错误 |
| `npm run build -w client/web` | 通过 |
| `npm test` (node --test + tsx: 规则引擎, 时间窗, 事件组与总览, 适配器) | 20 项全部通过 |
| `wrangler deploy --dry-run` | 打包通过 |
| `wrangler dev` + `node tools/e2e-v1.mjs` | 30 项全部通过, 同一实例重复运行也通过 |
| 旧版服务端写入 2 条 -> 新版启动 | `/api/messages` 返回原 seq 1, 2; 新消息 seq 3; `/api/v1/events` 中旧消息 id 为 m_1, m_2 |
| `tools/puller.mjs` 拉取 /health 推给 generic 适配器 | 入库 1 条 |

e2e 覆盖: dedupeKey 覆盖, 根因分组, 旧 /ws msg 帧与 send 回显, 用户规则 drop 与试运行, 来源 + key + Uptime Kuma webhook, 无 key 拒绝, 总览, Agent 注册, 等待确认, 危险动作二次确认, 在线投递, 幂等, 离线排队与 HTTP 拉取, 对话历史, key 不能读, 确认超时 (闹钟), 聚合窗口汇总 (闹钟), GitHub 验签通过与拒绝, 设置。

注意: wrangler dev 会把请求 url 改写成 wrangler.toml 的正式域名, 所以 e2e 只取 webhookUrls 的路径。
