# 环境变量与密钥总表

服务端 (Cloudflare Worker), 部署流程和安卓打包用到的所有变量都在这一张表。**新增, 改名, 删除变量必须在同一个提交里改这张表**, CI (`.github/scripts/env_doc_check.py`) 会核对 `server/src/env.ts`, `server/wrangler.toml` 和 `.github/workflows/*.yml`, 漏写或留着过期名字都会报错。

## 怎么配

- **仓库 secret / variable**: 仓库 Settings → Secrets and variables → Actions。部署 (`服务端部署` workflow) 会把它们同步成 Worker 的 secret, 配一次长期有效, 改了之后重新部署一次。
- **手动 secret**: 部署流程不管, 在 `server/` 下 `npx wrangler secret put 名字` 设一次。
- **wrangler.toml**: 写在 `server/wrangler.toml`, 随代码发布, 不是密钥。

级别: **必填** 不配跑不起来; **多账号必填** 只用一个令牌时可以不配, 要子号和接入 key 就必须配; **可选** 不配只是对应功能关掉; **插件** 只有启用对应插件才需要, 但**插件写明 "一起配" 的几项要么都配要么都不配**, 部署检查会拦。

## 部署本身 (CI)

| Worker 里 | 仓库里 | 级别 | 作用 / 缺了会怎样 |
| --- | --- | --- | --- |
| — | `CLOUDFLARE_API_TOKEN` (secret) | 必填 | 部署用的 CF API Token, 权限见 [cloudflare.md](cloudflare.md)。缺了部署直接失败 |
| — | `CLOUDFLARE_ACCOUNT_ID` (secret) | 必填 | CF 账号 id。缺了部署直接失败 |
| — | `ANDROID_KEYSTORE_BASE64` (secret) | 可选 | 安卓正式签名的 keystore, 见 [android-signing.md](android-signing.md)。缺了出 debug 签名包 |
| — | `ANDROID_KEYSTORE_PASSWORD` (secret) | 可选 | 上面 keystore 的密码 |

## 核心

| Worker 里 | 仓库里 | 级别 | 作用 / 缺了会怎样 |
| --- | --- | --- | --- |
| `AUTH_TOKEN` | `AUTH_TOKEN` (secret, 或手动) | 必填 | 母号全权限令牌。没在仓库配时部署不覆盖 Worker 里已有的值 |
| `TOKEN_SECRET` | `TOKEN_SECRET` (secret) | 多账号必填 | 签发访问令牌, 派生 webhook 签名, 加密 GitHub 授权令牌。缺了退回用 `AUTH_TOKEN` 派生, 更换会让所有 webhookSecret 和已存令牌失效 |
| `SETUP_CODE` | `SETUP_CODE` (secret) | 多账号必填 | 一次性母号初始化口令 (`POST /api/v1/setup`)。缺了不能初始化母号 |
| `HUB` | wrangler.toml 绑定 | 必填 | Durable Object, 全部数据都在这里 |
| `FILES` | wrangler.toml 绑定 (R2) | 可选 | 文件桶。部署建不了桶时自动去掉, 文件接口返回 503 |
| `TEMP_MAIL_DB` | wrangler.toml 绑定 (D1) | 可选 | 临时邮箱库, 每天清理超期邮件。没有就不清理 |
| `PLUGIN_MARKET` | 本地 `--var` | 可选 | 插件市场根地址, 只给本地测试用。不配就读仓库 main 的 `plugins/` |

## 功能 (可选)

| Worker 里 | 仓库里 | 级别 | 作用 / 缺了会怎样 |
| --- | --- | --- | --- |
| `CF_API_TOKEN` | `CF_ANALYTICS_TOKEN` (secret) | 可选 | CF 额度页, 只读 Account Analytics。缺了额度页显示未配置 |
| `CF_ACCOUNT_ID` | 由 `CLOUDFLARE_ACCOUNT_ID` 同步 | 可选 | 跟着上一项一起同步 |
| `DRIVE` | wrangler.toml 绑定 (Service) | 可选 | HX-CF-Drive, 和下面两项三项都配了才算接入, 见 [files.md](../features/files.md) |
| `CFD_ORIGIN` | wrangler.toml `[vars]` | 可选 | Drive 公网地址, 生成直链 |
| `CFD_TOKEN` | `CFD_TOKEN` (secret) | 可选 | Drive 受限令牌 (根目录 /aioa, 读写)。缺了文件只走 R2。网盘默认也用它; 根目录改成 / 即整盘, 附件自动放 /aioa 下 |
| `CFD_DRIVE_TOKEN` | `CFD_DRIVE_TOKEN` (secret) | 可选 | 网盘用的 Drive 令牌 (根目录 /, read+write, 要用量加 stats), 见 [drive.md](../features/drive.md)。缺了网盘用 `CFD_TOKEN`, 范围是它的根目录 |
| `AZURE_TRANSLATOR_KEY` | `AZURE_TRANSLATOR_KEY` (secret) | 可选 | 微软翻译 F0, 见 [translate.md](../features/translate.md)。缺了用谷歌免费通道 |
| `AZURE_TRANSLATOR_REGION` | `AZURE_TRANSLATOR_REGION` (secret) | 可选 | 区域资源的区域, 全局资源不填 |
| `TRANSLATE_MONTH_LIMIT` | 手动 | 可选 | 每月自动停止线 (字符), 默认 180 万 |
| `TRANSLATE_PROVIDER` | 手动 | 可选 | 强制翻译通道 `azure` / `google` |
| `MIPUSH_APP_SECRET` | 手动 | 可选 | 小米推送 AppSecret, 和 `MIPUSH_PACKAGE` 一起配 |
| `MIPUSH_PACKAGE` | 手动 | 可选 | 安卓包名 |
| `WXPUSHER_APP_TOKEN` | 手动 | 可选 | WxPusher 应用 token, 和 `WXPUSHER_UID` 一起配 |
| `WXPUSHER_UID` | 手动 | 可选 | WxPusher 用户 UID |

## 插件携带

| Worker 里 | 仓库里 | 插件 | 级别 | 作用 / 缺了会怎样 |
| --- | --- | --- | --- | --- |
| `GITHUB_TOKEN` | `AIOA_GITHUB_TOKEN` (secret) | `hengxin666.github` GitHub 接入 | 插件 | 只读 fine-grained token, cron 回填仓库, PR, Issue。缺了只靠 webhook 更新 |
| `GH_CLIENT_ID` | `AIOA_GH_CLIENT_ID` (variable) | `hengxin666.gh` GitHub 授权 | 插件, 和下一项一起配 | OAuth App 的 Client ID (开 Device Flow), 设备码授权要用。缺了只能粘贴令牌 |
| `GH_CLIENT_SECRET` | `AIOA_GH_CLIENT_SECRET` (secret) | `hengxin666.gh` GitHub 授权 | 插件, 和上一项一起配 | OAuth App 的 Client secret, 令牌 8 小时到期后自动续期要它。GitHub 2026-08 起新建 OAuth App 默认令牌 8 小时过期, 设置页显示没开也照样过期; 实测不带 secret 续不出能用的令牌。只配 ID 不配它, 部署检查报错, 设备码入口也不开 |

`hengxin666.todo` (点子待办) 和 `hengxin666.hxoa` (hxoa 管理) 不需要服务端变量; hxoa 的管理令牌在插件里配置, 加密存服务端。
