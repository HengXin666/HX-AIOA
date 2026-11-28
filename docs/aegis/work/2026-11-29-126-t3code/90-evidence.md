# 90 Evidence: Agent GUI Web 工作台对齐 t3code (#126)

## 命令

- `npm run typecheck`: protocol, server, web 全过 (退出码 0)。
- `npm run build -w client/web`: 通过, gui 包 148 KB (gzip 48 KB); 600 KB 主包警告是原有的。
- `BASE=origin/main npm run check:plugins`: 合入最新 main 后再跑, 结果见提交说明。

## 截图 (vite dev + `?agmock` 模拟主机, 暗色)

- 电脑 1440: [命令面板](shots/3-palette.png), [@ 文件 + 置顶分组](shots/5-mention.png), [本地诊断与本机通知](shots/7-diag.png)。
- 手机 390: [会话页](shots/8-mobile.png), [左栏抽屉](shots/9-mobile-sheet.png)。
- 脚本走了: Ctrl+K 开面板 (全局面板没有同时弹出), Ctrl+/ 快捷键一览, Ctrl+Shift+P 置顶, 输入 `@` 列出工作目录, Ctrl+S 暂存, Ctrl+B 收左栏; 页面无报错。
