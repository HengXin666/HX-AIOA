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
| [plugins.md](api/plugins.md) | 插件市场与安装, 白名单, 账号启用, 单选改选, 开发模式, 服务端插件 (L2a), 握手三档, 插件数据 pdata, 待办插件 |
| [rules.md](api/rules.md) | 规则引擎: 匹配顺序, 动作, 降噪 |

## 功能 `features/`

| 文档 | 内容 |
|---|---|
| [mail.md](features/mail.md) | 邮件聚合: CF 邮件路由 / HX-Email / 通用推送, 分类, 搜索, 正文存储 |
| [translate.md](features/translate.md) | 翻译: 微软 F0, 分段, 缓存, 每月自动停止 |
| [gh.md](features/gh.md) | GitHub 授权插件: 服务端保管令牌, 仓库范围, Agent 代办 issue, 待办与 issue 同步, 外部接入 (MCP) |
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

服务端与通用的在根目录, 某一端专属的放 `deploy/<端>/`。

| 文档 | 内容 |
|---|---|
| [env.md](deploy/env.md) | 环境变量与密钥总表 (必填, 可选, 插件携带), 改变量必须同步 |
| [cloudflare.md](deploy/cloudflare.md) | 服务端部署 (Workers, 密钥, CI) |
| [cf-usage.md](deploy/cf-usage.md) | CF 额度页与免费额度 |
| [android/signing.md](deploy/android/signing.md) | 安卓签名与自动发布 |
| [android/update-proxy.md](deploy/android/update-proxy.md) | 安卓自动更新与订阅代理 |

## 客户端开发 `client/`

按端分目录, 与代码目录 `client/<端>/` 和 issue 标签 (`安卓` / `Web`) 一一对应; Web 端文档在 #155 的 W1 开工时放进 `client/web/`。`cli.md` 是群 Agent 命令行, 不属于某一端。

| 文档 | 内容 |
|---|---|
| [android/ui-gallery.md](client/android/ui-gallery.md) | 组件库与电脑端预览画廊 |
| [android/settings-map.md](client/android/settings-map.md) | 安卓 "我的" 与设置页结构 |
| [android/battery.md](client/android/battery.md) | 后台耗电测量方法与记录 |
| [android/testing.md](client/android/testing.md) | 客户端测试: 单测, 布局静态检查, 截图测试计划 |
| [android/browser.md](client/android/browser.md) | 安卓内置浏览器: 链接入口, 登录态, 走订阅代理, 广告拦截 |
| [android/permissions.md](client/android/permissions.md) | 安卓权限清单: 现有, 规划, 申请时机 (#121) |
| [android/navigation.md](client/android/navigation.md) | 安卓返回键与页面跳转规则, 入口清单 |

## 设计与调研 `design/`

计划, 草案与实验记录, 留作背景; 与现行实现不一致时以 `api/` 和代码为准。

| 文档 | 状态 |
|---|---|
| [im-plan.md](design/im-plan.md) | 消息 (IM) 改造计划 |
| [multi-account-draft.md](design/multi-account-draft.md) | 多账号早期草案, 已被单库方案取代 |
| [push-experiment.md](design/push-experiment.md) | 推送延迟与耗电实验手册 |
| [research-cf-probe-panels.md](design/research-cf-probe-panels.md) | CF 探针面板调研 (#11) |
| [mockups/mail-feed.html](design/mockups/mail-feed.html) | 邮件页与统一推送 (福利群) 手机设计稿 (#66 #70) |
| [mockups/mail-detail.html](design/mockups/mail-detail.html) | 邮件详情重做设计稿: 原文内嵌, 图片拦截, 深色, 链接去向, 转进群 / 交给 Agent (#46) |
| [mockups/gh-todo.html](design/mockups/gh-todo.html) | GitHub 授权插件与待办关联 issue 手机设计稿 (#90 #98) |
| [agent-skill.md](design/agent-skill.md) | 云 Agent 设计统一草案: 现状图, 重构后图, skill 从 Git 下载, 两种提示词 (#117) |
| [ui-spec/README.md](design/ui-spec/README.md) | 安卓 UI 与交互规范 (对齐 HX-UI 2), 页面关系图 `sitemap.svg`, 可点原型 `prototype.html` (#121) |
| [ui-spec/home-spaces.md](design/ui-spec/home-spaces.md) | 新总览: ChatGPT 式侧栏, 空间切换, 插件的空间与区块怎么挂 (#121) |
| [ui-spec/hx-ui-sync.md](design/ui-spec/hx-ui-sync.md) | 安卓端如何跟随 HX-UI: 令牌导出, 组件对照, 版本锁定 (#121) |
| [agent-gui.md](design/agent-gui.md) | Agent GUI 方案: 全部 ACP, 探针多路代理, 直连 (本机 / 局域网 / CF Tunnel) 不占 Worker 与 DO, 审批模式, 实时统计 (#126) |
| [agent-gui-ui.md](design/agent-gui-ui.md) | Agent GUI 界面方案: 桌面工作台, 手机工作 / 审批模式, 原型图 3-desktop.svg 4-mobile.svg (#126) |
| [ui-spec/message-pages.md](design/ui-spec/message-pages.md) | 消息页: 人 / 群 / 域 / Agent 概念, 群会话与群资料页, 每个元素的请求数, 省 CF 额度的改法, 兼容性 (#121) |
| [ui-spec/android-rebuild.md](design/ui-spec/android-rebuild.md) | 安卓前端全量重构: 分期, 接口对账 (够不够用), 对接是否合理与要改的地方 (#121) |
| [web-arch.md](design/web-arch.md) | Web 端架构: 同源 CF 静态资源部署, HX-UI 2 电脑三栏布局, 额度规则, Web Push, 图表重做, 插件按端兼容声明与 CI 校验; 桌面客户端候选 (#155) |
| [plugin-arch.md](design/plugin-arch.md) | 插件体系定稿 v1 (D 方案): 结论, 清单 v2, 运行时, 数据, 权限, 请求预算, 实施顺序 (#99) |
| [weekly-report/prototype.html](design/weekly-report/prototype.html) | 周报原型: 单文件无外链, 平台使用 (前台时长, 打开次数, 活跃时段), 消息, 人际, 配置计数, 本机记录 (传输, 终端, 请求, 电量, 通知), GitHub 一角; 模拟数据 (#140) |

## 过程记录 `aegis/`

任务意图, 检查点与证据, 由 `aegis-workspace.py` 维护, 不手改。

## 新增文档

放进上面对应的目录, 并在本页登记一行。
