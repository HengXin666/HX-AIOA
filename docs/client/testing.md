# 客户端测试

安卓构建 (`.github/workflows/android.yml`) 在出包前跑 `:app:testDebugUnitTest`, 任何一条失败就不发版。

## 现在有的

| 层 | 在哪 | 测什么 |
| --- | --- | --- |
| 纯逻辑单测 | `client/android/app/src/test/` | 返回路径 (`TabNavTest`), 解析与模型 |
| 布局静态检查 | `ui/LayoutLintTest.kt` | 扫源码里反复出过的错误写法, 如 Row 里 `weight(fill = false)` 和 `Spacer(weight)` 并列导致右侧不贴边 (#109 邮件时间) |

布局静态检查不跑界面, 几毫秒扫完全部源码, 不需要新依赖。修一个布局回归时, 能用一条文本规则描述的就加进去。

## 下一步: 截图测试

静态检查只能抓写法, 抓不到 "看起来不对"。计划用 Roborazzi (JVM 上跑 Compose, 不要模拟器):

1. 给常回归的组件 (邮件行, 信息流卡片, 插件详情头部) 写固定数据的预览, 覆盖窄屏 / 宽屏, 亮 / 暗, 长名字。
2. 基准图放仓库, CI 用 `verifyRoborazziDebug` 比对, 不一致时把差异图作为构建产物上传。
3. 改界面时本地或 CI 跑 `recordRoborazziDebug` 更新基准图, 和代码一起提交。

依赖要联网下载, 本地离线编译用不了, 先在 CI 里接。网页端 (`client/web`) 还没开始做, 暂不在范围内。
