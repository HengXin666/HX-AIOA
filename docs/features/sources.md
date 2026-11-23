# 接入数据源

数据源就是 "事件从哪里来": GitHub 仓库, Uptime Kuma, 自己的脚本等。每个数据源创建时会绑定一把接入 key, 外部系统用它把事件推进来。适配器细节见 [接入适配器](../api/connectors.md)。

## 1. 前提

服务端需要两个 secret (`npx wrangler secret put <名字>`):

- `AUTH_TOKEN`: 客户端令牌, 也是管理数据源的凭证。
- `TOKEN_SECRET`: 用来派生每把 key 的 Webhook Secret。没有它就无法做 GitHub 验签, 只能退回在地址里带 `?key=`。
- `GITHUB_TOKEN` (可选): GitHub 只读令牌, 用于 GitHub 页面回填, 见第 2 节末尾。

## 2. 在 App 里接入 GitHub (推荐)

1. 打开 Web 端 "我的" → "添加数据源", 类型选 GitHub (排在第一个)。
2. 填仓库 `owner/repo`, 如 `HengXin666/HX-AIOA`; 名称可留空。点 "创建"。
3. 进入详情页, 按步骤操作:
   - 点 "打开 owner/repo 的 Webhook 设置", 即 `https://github.com/{owner}/{repo}/settings/hooks/new` (需要仓库管理员权限)。
   - Payload URL: 点复制, 粘贴到 GitHub。
   - Content type: 选 `application/json`。
   - Secret: 点复制, 粘贴到 GitHub。
   - 事件: 选 "Let me select individual events", 建议勾选 Pushes, Pull requests, Issues, Issue comments, Workflow runs, Releases, Stars。只关心 CI 就只勾 Workflow runs。
   - 点 "Add webhook"。
4. GitHub 会立刻发一个 `ping`, 服务端生成事件 `[repo] GitHub Webhook 已连接`, 详情页状态变成 "已连接 ✓"。

注意:

- Key 与 Secret 只在创建后显示一次, 离开详情页就无法再查看。丢了就删除数据源重建。
- 如果详情页提示 "服务端没有配置 TOKEN_SECRET", Payload URL 会自动带上 `?key=`, Secret 留空即可; 配好 `TOKEN_SECRET` 后建议重建。
- 仓库会写成关注对象 `github:owner/repo`, 与适配器产生的事件一致, 工作台和规则可以按它筛选。
- 默认规则: GitHub 的 info 级动态 (push, star, CI 成功等) 只进摘要; CI 失败, 请求我 review 会提醒。可在 "规则" 里调整。
- 在 "我的" 的数据源列表里点垃圾桶删除数据源, 绑定的 key 同时作废, GitHub 之后的推送会被拒绝 (401)。

### GitHub 页面与 GITHUB_TOKEN (可选)

App 的 GitHub 页面展示每个仓库的 stars, 开放 PR / Issue, 最近推送, CI 状态与动态, 接口见 [GitHub 接口](../api/github.md)。只靠 webhook 时, 接入之前已经存在的 PR 和 Issue 看不到; 配上只读令牌后服务端会回填, 并每 30 分钟自动同步一次。

1. 打开 GitHub Settings → Developer settings → Fine-grained personal access tokens → Generate new token。
2. Repository access 选要展示的仓库 (或 All repositories)。
3. Repository permissions 只给只读: Metadata, Contents, Issues, Pull requests, Actions 都选 Read-only, 其余保持 No access。
4. 写进服务端: `npx wrangler secret put GITHUB_TOKEN`; 用 CI 部署的话, 在仓库 Settings → Secrets 里加 `AIOA_GITHUB_TOKEN`, 部署时会同步为 Worker 的 `GITHUB_TOKEN` (没配就跳过)。
5. 在 App 里点 "同步", 或调用 `POST /api/v1/github/sync`。

令牌只放 secret, 不要写进仓库或 App。

不连服务端想先看流程: 打开 Web 端时加 `?mock=1`, 创建后约 3 秒会模拟收到 ping。

## 3. 用 curl 接入 GitHub

```bash
SERVER=https://你的域名
TOKEN=你的 AUTH_TOKEN

curl -s -X POST "$SERVER/api/v1/sources" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"HX-AIOA","type":"github","subject":"github:HengXin666/HX-AIOA","key":{}}'
```

返回里:

- `key.webhookUrls.github`: GitHub 的 Payload URL (`/api/v1/hooks/github/{keyId}`)。
- `key.webhookSecret`: GitHub 的 Secret。为空说明服务端缺 `TOKEN_SECRET`。
- `key.key`: 接入 key, 只返回这一次。

然后按第 2 节在 GitHub 填写。自己模拟一次 GitHub 推送 (签名是对原始请求体的 HMAC-SHA256):

```bash
BODY='{"zen":"hi","repository":{"full_name":"HengXin666/HX-AIOA"}}'
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | sed 's/^.* //')"
curl -s -X POST "$WEBHOOK_URL" -H "Content-Type: application/json" \
  -H "X-GitHub-Event: ping" -H "X-Hub-Signature-256: $SIG" -d "$BODY"
```

签名错误返回 401。查看与删除:

```bash
curl -s "$SERVER/api/v1/sources" -H "Authorization: Bearer $TOKEN"
curl -s -X DELETE "$SERVER/api/v1/sources/{id}" -H "Authorization: Bearer $TOKEN"
```

完整的端到端校验脚本: `tools/e2e-github.mjs` (见第 5 节)。

## 4. 其他来源

在 App 里选对应类型创建, 详情页给出:

- 有适配器的类型 (通用 Webhook, Uptime Kuma, Beszel, Healthchecks, Netdata, Prometheus): 一个带 `?key=` 的 Webhook 地址, 直接填进对方系统的通知设置。各类型的具体填法见详情页的配置说明与 [接入适配器](../api/connectors.md)。
- 没有适配器的类型 (脚本, Agent, 探针, 邮件, 拉取任务): 给出事件接口 `/api/v1/events` 与 key, 请求头 `Authorization: Bearer <key>`。

curl 方式同样是 `POST /api/v1/sources` 带 `"key":{}`, 把 `type` 换成对应类型, 再用 `key.webhookUrls[适配器]?key=<key.key>` 作为对方的推送地址。例如通用 Webhook:

```bash
curl -s -X POST "$WEBHOOK_URL?key=$KEY" -H "Content-Type: application/json" \
  -d '{"title":"备份完成","summary":"耗时 3 分钟"}'
```

收到第一条事件后, App 详情页同样显示 "已连接 ✓"。

## 5. 本地验证 (开发者)

```bash
cd server
printf 'AUTH_TOKEN=test-owner-token\nTOKEN_SECRET=test-token-secret\n' > .dev.vars   # 已在 .gitignore, 不要提交
npx wrangler dev --port 8787

# 另开终端, 在仓库根目录
AIOA_SERVER=http://127.0.0.1:8787 AIOA_TOKEN=test-owner-token node tools/e2e-github.mjs
```

脚本会创建 github 来源, 签名发送 `ping`, `push`, `pull_request`, `issues`, `workflow_run`, 确认事件入库, 校验 GitHub 页面接口的摘要与详情 (PR 关闭后从列表消失), 再确认错误签名, 无签名和删除来源后的推送都被拒绝。`wrangler dev` 会把返回地址的域名换成 `wrangler.toml` 里 routes 的域名, 脚本只取路径发往本地。
