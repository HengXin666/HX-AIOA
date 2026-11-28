# 10 Intent: Agent GUI Web 工作台对齐 t3code (#126)

- 目标: 把 t3code Web 工作台的交互 (快捷键模型, 命令面板, 左栏置顶 / 归档 / 未读 / 折叠, 草稿与暂存, @ 文件, 图片, 消息操作, 通知) 搬到 `client/web` 的 Agent GUI; 去掉 t3code 的遥测上报, 换成只在本机的诊断。
- 范围: 只改 Web (`client/web/src/agentgui`, `client/web/src/ui/agent/gui`) 与文档; 不改协议, 服务端, 探针, 安卓。
- 切片: 1 快捷键与命令面板; 2 左栏; 3 输入框 (草稿, 暂存, @, 图片); 4 时间线; 5 本地诊断与通知; 6 窄屏抽屉。
- 验收: `npm run typecheck`, `npm run build -w client/web`; dev 模拟主机下电脑 1440 与手机 390 截图自检; 清单见 `docs/design/agent-gui-t3code.md`。
