# Agent GUI 对齐 t3code (#126, 仅 Web)

工作台 "照搬 t3code" 的落地清单。t3code 原码在 [pingdotgg/t3code](https://github.com/pingdotgg/t3code) `apps/web`, 本文只记我们搬了什么, 怎么换的, 还差什么。界面方案仍以 [agent-gui-ui.md](agent-gui-ui.md) 为准。

## 1. 已搬 (行为与 t3code 一致)

| t3code | 本端 | 位置 |
| --- | --- | --- |
| 按键 -> 命令 + when 条件 (`packages/shared/src/keybindings.ts`) | 同一模型与默认键位, 只取本端有的命令 | `client/web/src/agentgui/keybindings.ts` |
| 命令面板 `mod+k`: 会话优先, 置顶在前, 命令带快捷键 | 跨主机搜会话, 命令, 切主机; 工作台内盖过全局面板 | `ui/agent/gui/Palette.tsx` |
| 左栏 `mod+b` 收起, 窄屏抽屉 | 收起记在本机; 窄屏 (< 720) 改抽屉, 切会话自动收 | `ui/agent/gui/index.tsx`, `layout.tsx` |
| 会话置顶 `mod+shift+p`, 归档 (settle) `mod+shift+s`, 复制引用 `mod+shift+c` | 右键菜单与快捷键; 归档默认收起, 搜索时也搜 | `ui/agent/gui/Sidebar.tsx`, `agentgui/prefs.ts` |
| 未读: 完成后没看过的会话加粗 + 蓝点 | 以打开会话时的 `updated` 为已读线 | 同上 |
| 项目分组可折叠 | 按 cwd 分组, 折叠记在本机 | 同上 |
| 上下一个会话 `mod+shift+[` `]`, `mod+1..9` 跳第 n 个 | 按左栏顺序 (置顶在前, 跳过归档) | `ui/agent/gui/index.tsx` |
| 草稿按会话自动保存 (composerDraftStore) | 300 ms 合并落盘, 左栏标 "草稿" | `agentgui/prefs.ts`, `Composer.tsx` |
| 暂存 `mod+s` (promptStashStore) | 有字 = 存入, 空 = 取回最近一条, 每会话 20 条 | 同上 |
| `@` 文件提及 | 按层走探针 `fs/tree`, 发送时附 ACP `resource_link` | `ui/agent/gui/Mentions.tsx` |
| 粘贴 / 拖入 / 选图片 | 只在 Agent 声明 `promptCapabilities.image` 时开, 单张 5 MB | `Composer.tsx` |
| 模型面板 `mod+shift+m`, 权限模式 `mod+shift+a`, 打开改动 `mod+d`, 右栏 `mod+alt+b`, 文件 `mod+p` | 同键位 | `index.tsx`, `Session.tsx` |
| 消息复制, 放回输入框改了再发; 回到最新 | 悬停出现; 离开底部时浮出 "回到最新" | `Timeline.tsx` |
| 快捷键一览 | `mod+/` | `Keys.tsx` |
| 会话结束的桌面通知 | 页面不在前台时: 跑完 / 等你 / 出错, 默认关, 设置里开 | `agentgui/notify.ts` |

## 2. 遥测与上报: 全部去掉, 换成本地诊断

t3code Web 端有三条上报: `observability/clientTracing.ts` (OTLP 链路追踪, 每秒导出到服务端), `lib/backgroundActivityReporter.ts` (每 25 秒上报客户端活动租约), `lib/resourceTelemetryState.ts` 与设置里的遥测导出。本端一条都不搬:

- 换成 `agentgui/diag.ts`: 只在这台设备的内存里记 连路线 / 连上 / 断开 / hx 请求的方法名, 耗时, 成败, 以及下行帧数与字节; 环形 500 条, 刷新即清。
- 只记主机名与上面这些计数, 不记会话内容, 路径, 命令与地址; 不经 Hub, 不发任何网络请求。设置页 "本地诊断" 看汇总 (p50 / p95, 失败数, 帧率), 用户自己点 "导出 JSON" 才落到本地文件。
- 后台活动租约在本端由已有机制覆盖: 前后台走直连帧 `fg` (决定审批是否静默), 不需要另报。
- 端到端加密: 现在没有任何上报, 所以不需要。以后若要把诊断交给主机或经 Hub 收集, 规则是: 只发给探针走直连 (本来就是设备签名认证的私有链路); 经 Hub 时必须先用配对时记下的主机公钥 (ECDH P-256 + AES-GCM) 加密, Hub 只见密文, 且只发汇总不发明细。

## 3. 还没搬 (需要探针配合, 不在本期)

终端抽屉 `mod+j` (探针 PTY), checkpoint 回退 / `mod+z` 撤销一轮, worktree 与分支选择, 提交 / 推送 / PR, 项目脚本, 预览面板, 用量页 `mod+u`, 主题编辑器, 键位自定义文件。
