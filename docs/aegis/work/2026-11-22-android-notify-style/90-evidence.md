# 安卓通知: 自有图标与按内容分样式 - Evidence

No evidence has been recorded yet.

## 验证记录

- `gradle :app:compileReleaseKotlin` (沙箱, JDK 17, in-process): BUILD SUCCESSFUL, 本次改动文件无新增警告。
- 8 个 ic_stat 矢量图标转 SVG 后用 cairosvg 渲染成 24/36/48/120 像素预览, 人工确认在深色底上可辨认。
- 决定: Agent 通知按钮走 `POST api/v1/tasks/{id}/actions` (服务端 api-agent.ts 已有); 危险确认不给一键批准, 只给 "打开" 与 "拒绝"。
- 决定: 同类通知共用一个 id, 用 tag 区分来源或去重键; 告警用 dedupeKey 作 tag, 恢复时更新同一条为 "已恢复"。
- 未做: 真机效果验证 (沙箱无设备)。
