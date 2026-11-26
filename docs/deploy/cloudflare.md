# 服务端部署 (Cloudflare Workers)

服务端部署到 Cloudflare, 域名 `aioa.woa.qzz.io`。支持两种方式:

- **本地手动**: 在 `server/` 下 `npm run deploy` (需要本机已 `wrangler login`)。
- **GitHub Actions 手动触发**: 打开 Actions 页运行 "服务端部署", 点一下就跑一次 `wrangler deploy`, 本机无需登录 CF。

## 一次性配置

在仓库 Settings → Secrets and variables → Actions → New repository secret 添加:

| 名称 | 内容 | 必填 |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token, 权限见下 | 是 |
| `CLOUDFLARE_ACCOUNT_ID` | `1783b3f87c780c3fbca6dab5aaed19a7` | 是 |
| `AUTH_TOKEN` | 客户端令牌; 仅当需要由 CI 同步 Worker 密钥时才填 | 否 |

### CLOUDFLARE_API_TOKEN 怎么建

Cloudflare 后台 → My Profile → API Tokens → Create Token → Custom token, 权限:

- **Account** · Workers Scripts · **Edit**
- **Account** · Workers KV Storage · **Edit** (若以后用到 KV)
- **Zone** · Workers Routes · **Edit**
- **Account** · Account Settings · **Read**

Account Resources 选 `Heng_Xin`; Zone Resources 选 `woa.qzz.io` (自定义域名在该 zone 下)。

> 不要用 `wrangler login` 产生的 OAuth token 填进 CI: 它几十分钟就过期, 撑不住长期使用。

## 运行时密钥 (AUTH_TOKEN 等)

> 全部变量 (必填, 可选, 插件携带) 和仓库里对应的名字见 [env.md](env.md), 以那张表为准。

Worker 的运行时密钥 (`AUTH_TOKEN` / `MIPUSH_APP_SECRET` 等) **不是**部署命令的一部分, 用 `wrangler secret put` 单独设置, 已设置过一次就长期保留。

- 当前 `AUTH_TOKEN` 已在 Worker 里配置好, 手动触发的部署**不会覆盖**它。
- 若确实想让 CI 一并同步 `AUTH_TOKEN`, 在 GitHub 里也加一个同名 `AUTH_TOKEN` secret, workflow 会在部署后自动 `secret put`。
- v1 接入 (#3) 建议再设置 `TOKEN_SECRET` (仓库 Actions secret, 部署时自动同步到 Worker; 或手动 `wrangler secret put TOKEN_SECRET`, 任意长随机串): 各接入 key 的 webhook 签名密钥由它派生, GitHub Webhook 验签需要它; 更换后所有 `webhookSecret` 随之改变。

## 部署后会做什么

1. `npm ci` 安装依赖
2. `npm run typecheck` 类型检查
3. 校验 `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` 存在
4. `wrangler deploy` 部署 Worker 并绑定自定义域名

## 注意

- 部署只发代码, 不改 DNS (自定义域名由 `wrangler.toml` 的 `[[routes]]` 声明, 首次部署时自动建)。
- `woa.qzz.io` 开了 Bot Fight/Managed Challenge, 非浏览器 UA 会被 403; 真机客户端请确保 UA 不是裸 `node`/`okhttp` 默认值, 或在 CF 后台给该 host 关闭挑战。
