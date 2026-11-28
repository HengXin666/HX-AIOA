# Web 与安卓功能对照 (#155)

Web 端与安卓用同一套服务端接口, 功能应完全一致, 只是排版不同。本表按接口逐组对照, 做完一组改一行; 判断依据是 `client/web/src` 里有没有用到对应的 `PATH_*`。

Agent / 探针 / Webhook 侧的接口 (`PATH_AGENT_NEXT`, `PATH_AGENT_DONE`, `PATH_HOOKS`, `PATH_EXT_MCP` 等) 不属于客户端, 不在表里。

| 功能 | 接口 | Web 状态 |
| --- | --- | --- |
| 会话列表, 消息, 已读, 置顶 / 免打扰 | `PATH_CHATS` `PATH_CHAT` `PATH_CHAT_MESSAGES` | 已做 |
| 转发, 合并转发详情, 多选, 收藏, @ | `PATH_FAVORITES` `PATH_EVENTS_BY_SEQS` | 已做 (ee9f18e) |
| 邮件群 (列表, 详情, 翻译, 转进群) | `PATH_MAIL*` `PATH_TRANSLATE` | 已做 (25cf4a0); 偏好与规则 `PATH_MAIL_PREFS` `PATH_MAIL_RULES`, 站点图标 `PATH_MAIL_ICON` 未做 |
| 信息流群 | 消息里的 `data.feed` | 已做 (25cf4a0); 标签编辑 `PATH_AGENT_FEED_TAGS` 未做 |
| 群资料 (群名, 公告, 开关, 邀请, 清空, 删除, 退出) | `PATH_CHAT` `PATH_CHAT_INVITES` `PATH_CHAT_MEMBER` | 已做 (6e98447) |
| 发送者头像, 成员头像, 自己的旧版头像 | `PATH_SENDERS` `PATH_CHAT_MEMBERS` `PATH_SETTINGS` | 已做 (765b9b2); 主人改发送者别名 / 头像 `PATH_SENDER` 未做 |
| 群 Agent 设置与接入向导 | `PATH_CHAT_AGENTS` `PATH_CHAT_AGENT*` | 已做 (69f379a) |
| 单聊, 资料卡, 共同群, 按邀请码进群 | `PATH_DMS` `PATH_USER_ROOMS` `PATH_ROOM_JOIN` | 未做 |
| 账号, 成员与邀请, 邀请码注册 | `PATH_ME*` `PATH_USERS` `PATH_INVITES` `PATH_JOIN` | 已做 (4030f64) |
| 数据源, 接入总览 | `PATH_SOURCES` `PATH_SOURCE_TYPES` `PATH_INTEGRATIONS` `PATH_KEYS` | 已做 (fca1a40); 规则 `PATH_RULES*` 未做 |
| 存储与迁移 | `PATH_FILES` `PATH_FILES_MIGRATE` | 已做 (fca1a40) |
| hxoa 远程管理 | `PATH_HXOA*` | 已做 (336ab68); 新建文件夹 `PATH_HXOA_MKDIR` 未做 |
| 待办 | `PATH_PDATA_COLL` `PATH_PDATA_ITEM` (待办集合) | 看板, 编辑, 总览重点待办已做; 外部接入密钥 `PATH_TODO_EXT*`, 群里的待办页, 周期与提醒编辑未做 |
| 空间 / 看板 / 工作台组件 | `PATH_SPACES` `PATH_SPACE*` `PATH_PDATA_*` | 未做 |
| 网盘 | `PATH_DRIVE*` | 未做 |
| GitHub 卡, 走势, 分支, Issue | `PATH_GITHUB_*` `PATH_GH_*` | 部分 (资源栏仓库列表); 其余未做 |
| 插件市场与开发者模式 (#156) | `PATH_PLUGIN*` | 未做 |
| 终端 | `PATH_SHELL_TICKET` `PATH_PROBES` | 未做 |
| CF 额度 | `PATH_CF_USAGE` | 已做; `PATH_CF_ZONES` `PATH_CF_STORAGE` 未做 |
| 审计, 账号组 | `PATH_AUDIT` `PATH_GROUPS` | 未做 |

Web 端按设计稿不做: 代理, 保活, 耗电, APK 更新, 系统权限, 内置浏览器 (链接一律新标签页)。

## 等 HX-UI 补的组件

Web 端只用 HX-UI 2 组件; HX-UI 还没有的, 先用最少的原生元素顶上, 并在 HX-UI 仓库提了单独的 issue, 组件发布后替换。

| 用途 | 现在的写法 | HX-UI issue |
| --- | --- | --- |
| 列表行 (会话, 邮件, 收藏, 我的导航) | 原生 button / a | HengXin666/HX-UI#58 |
| 空状态 | `ui/kit/Panes.tsx` EmptyState | HengXin666/HX-UI#59 |
| 长列表虚拟滚动 | 全量渲染 | HengXin666/HX-UI#60 |
| 分栏拖宽 | 固定宽度 | HengXin666/HX-UI#61 |
| 拖放上传与进度 | 未做 | HengXin666/HX-UI#62 |
| 头像裁剪 | 自动居中裁 | HengXin666/HX-UI#63 |
| @ 提及输入 | `ui/chat/Mentions.tsx` 浮层 | HengXin666/HX-UI#64 |
| 可复制字段 | 原生 button | HengXin666/HX-UI#65 |
| 筛选标签 (带计数) | Button xs | HengXin666/HX-UI#66 |
