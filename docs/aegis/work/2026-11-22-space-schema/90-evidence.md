# 工作台 schema (#5) - Evidence

2026-11-22, 分支 hark/issue5 (基于 main cbc7fa6), 均在本地新鲜运行。

| 命令 | 结果 |
| --- | --- |
| `npm install` | 通过, up to date |
| `npm run typecheck` (protocol + server + web) | 通过, 0 错误 |
| `npm test` (node --test + tsx) | 25 项全部通过, 新增 5 项: 组件分类与合法布局, 坏输入全部报出, 显示状态合并与拒绝, 三种来源产出标准字段, 按绑定解析当前值 |
| `npm run build -w client/web` | 通过 |
| `wrangler dev` + `node tools/e2e-v1.mjs` | 44 项全部通过 (新增 13 项: 缺 question 被拒, 调整尺寸, 尺寸推给其他设备, 非法尺寸与未知面板被拒, 重新下发保留排序与尺寸, Prometheus 适配器, 别名换成标准字段, 换来源不改绑定, 列表解析最近事件); 同一实例重复运行也通过 |
| `./gradlew :app:compileDebugKotlin :ui:compileKotlinDesktop` | 通过 |
| `./gradlew :ui:recordRoborazziDesktop` | KitScreenshotTest 5 项, SpaceScreenshotTest 4 项全部通过; 生成手机, 平板, 编辑模式三张工作台截图 |
| Web mock 页面 (playwright, 1280 宽) | 编辑布局后放大与上移生效, 存入本地显示状态, 无页面错误; chat 与 approval 组件正常渲染 |

注意: e2e 用临时 `.dev.vars`, 跑完已删除。
