# 工作台: 组件数据体系与微页面 schema (#5) - Intent

- 目标: 补齐 #5 在 PR #14 之后的缺口: 面板可调尺寸, 来源无关的数据绑定, 安卓 Compose 渲染同一份 schema, 每个图表写明回答的问题。
- 范围: protocol (space, space-layout, metric-fields), server (spaces, space-data, 指标适配器), client/web (工作台组件), client/android (ui 组件库 + app 资源页), tools/e2e-v1.mjs, docs/api-v1-spaces.md。
- 非目标: 多账号下发 (`to` 字段), 面板高度调整, 拖拽改尺寸手势 (两端用按钮逐档调整), 服务端主动拉取外部来源 (仍由 puller 推送)。
- 不变量: protocol/ 仍为唯一真源; 只用休眠 WebSocket; 指标不逐点落库; 显示状态与布局分开存, Agent 重新下发不覆盖; :link 进程不加载任何界面类 (工作台 JSON 只在界面进程解析)。
- 关键决定:
  - 组件分类用一张 `CATEGORY_OF` 表, 两端组件集合与之对齐; 新增 `chat` 与 `approval` 两个交互类组件。
  - 图表 (`sparkline`, `line`, `ring`) 必须有 `question`, 由校验强制。
  - 绑定只认标准字段名, 服务端在入口把来源原生名换成标准名, 换来源不改布局; `bind.source` 只做声明。
  - 同一主体的最新值按字段合并, 支持不同字段来自不同来源。
  - 尺寸沿用 `s/m/l/full` 四档, 对应 4 列网格的 1 到 4 列, 用户调整存在 `state.sizes`。
  - `GET /spaces/{id}/data` 返回按绑定解析的当前值, 客户端打开即有数据, 之后由 watch 推送接管。
