# UI 组件库与电脑端预览

组件库在 `client/android/ui` (Compose Multiplatform, 安卓与桌面共用), 预览画廊在 `client/android/gallery`。对应 issue #9。

## 电脑端预览

需要 JDK 17 以上, 在 `client/android` 下执行:

```bash
./gradlew :gallery:hotRunDesktop -PdesktopOnly=true --auto
```

窗口左侧可切换页面, 设备 (手机 / 平板竖屏 / 平板横屏), 明暗, 主题色, 圆角, 密度; 改 `ui` 或 `gallery` 下的代码保存后自动热重载, 不用重启。
不带热重载: `./gradlew :gallery:run -PdesktopOnly=true`。

## 响应式

按可用宽度分三档, 与设备型号无关:

| 档位 | 宽度 | 导航 | 网格 |
| --- | --- | --- | --- |
| Compact | < 600dp | 底部导航 | 每格 ≥150dp, 手机为两列 |
| Medium | 600-840dp | 左侧导航栏 | 每格 ≥210dp |
| Expanded | ≥ 840dp | 左侧导航栏, 内容限宽 1040dp 居中 | 每格 ≥210dp |

组件用 `AdaptiveGrid` 排布, 图表等宽组件占满一行。

## 截图

```bash
./gradlew :gallery:screenshots -PdesktopOnly=true
```

每个页面 x 设备 x 明暗输出 PNG 到 `gallery/build/screenshots`, 后续接入 CI 对比。

## 连真数据

设置 `AIOA_SERVER`, `AIOA_TOKEN`, `AIOA_SUBJECT` 后画廊总览页的 CPU 和内存改用探针实时数据, 详见 `docs/features/metrics.md`。
