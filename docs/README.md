# 文档索引

先看根目录 `README.md` (是什么, 怎么跑), 开发规范见 `AGENTS.md`。类型定义的真源是 `protocol/src/v1/`, 文档给语义与例子。

## 接口 `api/`

| 文档 | 内容 |
|---|---|
| [v1.md](api/v1.md) | 总契约: 账号, 邀请与多人群, 接入 key, 事件模型, 规则, Agent, 工作台, 设置 |
| [stream.md](api/stream.md) | `/api/v1/stream` WebSocket 帧 |
| [chat.md](api/chat.md) | 群资料, 群消息, 群里的 Agent, 引用转发, 收藏, HTML 卡片 |
| [connectors.md](api/connectors.md) | 各来源适配器的字段映射, 去重与分组 |
| [spaces.md](api/spaces.md) | 工作台布局与组件 |
| [github.md](api/github.md) | GitHub 页面接口 |

## 功能 `features/`

| 文档 | 内容 |
|---|---|
| [mail.md](features/mail.md) | 邮件聚合: CF 邮件路由 / HX-Email / 通用推送, 分类, 搜索, 正文存储 |
| [feed.md](features/feed.md) | 统一推送卡片: feed 格式, 信息流展示, 用过 / 失效标记 |
| [files.md](features/files.md) | 文件: R2 存储, 票据, 额度 |
| [sources.md](features/sources.md) | 接入数据源 (GitHub, Uptime Kuma 等) 的操作步骤 |
| [metrics.md](features/metrics.md) | 实时指标的懒更新 |
| [terminal.md](features/terminal.md) | 一行安装探针, 经探针中转的终端 |
| [../plugins/README.md](../plugins/README.md) | 插件市场格式 |

## 给 Agent

| 文档 | 内容 |
|---|---|
| [agent-guide.md](agent-guide.md) | Agent 接入说明。地址已写进各 Agent 的长期指令, 不要移动或改名 |
| [client/cli.md](client/cli.md) | `hxaioa` 命令行: 配置一次就能收发消息, 长连监听 |

## 部署与运维 `deploy/`

| 文档 | 内容 |
|---|---|
| [cloudflare.md](deploy/cloudflare.md) | 服务端部署 (Workers, 密钥, CI) |
| [cf-usage.md](deploy/cf-usage.md) | CF 额度页与免费额度 |
| [android-signing.md](deploy/android-signing.md) | 安卓签名与自动发布 |
| [android-update-proxy.md](deploy/android-update-proxy.md) | 安卓自动更新与订阅代理 |

## 客户端开发 `client/`

| 文档 | 内容 |
|---|---|
| [ui-gallery.md](client/ui-gallery.md) | 组件库与电脑端预览画廊 |
| [settings-map.md](client/settings-map.md) | 安卓 "我的" 与设置页结构 |
| [android-battery.md](client/android-battery.md) | 后台耗电测量方法与记录 |
| [browser.md](client/browser.md) | 安卓内置浏览器: 链接入口, 登录态, 走订阅代理, 广告拦截 |

## 设计与调研 `design/`

计划, 草案与实验记录, 留作背景; 与现行实现不一致时以 `api/` 和代码为准。

| 文档 | 状态 |
|---|---|
| [im-plan.md](design/im-plan.md) | 消息 (IM) 改造计划 |
| [multi-account-draft.md](design/multi-account-draft.md) | 多账号早期草案, 已被单库方案取代 |
| [push-experiment.md](design/push-experiment.md) | 推送延迟与耗电实验手册 |
| [research-cf-probe-panels.md](design/research-cf-probe-panels.md) | CF 探针面板调研 (#11) |
| [mockups/mail-feed.html](design/mockups/mail-feed.html) | 邮件页与统一推送 (福利群) 手机设计稿 (#66 #70) |

## 过程记录 `aegis/`

任务意图, 检查点与证据, 由 `aegis-workspace.py` 维护, 不手改。

## 新增文档

放进上面对应的目录, 并在本页登记一行。
