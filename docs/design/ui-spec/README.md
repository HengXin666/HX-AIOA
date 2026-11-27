# 安卓 UI 与交互规范 (HX-UI 对齐)

> 专项 issue: 见 #121。本目录是规范的唯一来源, 改规范先改这里, 再按 issue 的清单改代码。

| 文件 | 是什么 |
| --- | --- |
| `pages.json` | 全部页面与跳转关系的数据 (唯一来源) |
| `sitemap.svg` / `sitemap.png` | 页面关系图, 由 `gen.py` 生成 |
| `prototype.html` | 可点原型: 手机里每一页都能点开, 返回键按规范走; 右侧有关系图 (点节点直达), 交互规范, 令牌, 组件 |
| `gen.py` | `python3 gen.py`, 只用标准库; 改了 `pages.json` 或 `prototype.src.html` 后运行, 生成物一起提交 |

浏览器直接打开 `prototype.html` 即可, 不联网也能用。

## 1. 目标

1. 视觉跟 HX-UI 2 (`../HX-UI/next`, shadcn 令牌) 是同一套: 颜色, 字号, 圆角, 间距, 动效全部取令牌, 网页端与安卓端看起来是一个产品。
2. 交互只有一种写法: 四种容器, 一套返回规则, 一套反馈与三态。
3. 以后的页面和插件必须用组件库 (`client/android/ui`) 的容器与组件; 要不一样, 写插件替换 (见第 6 节), 不在页面里自己画。

## 2. 令牌

来源: HX-UI `next/src/styles/theme.css` (OKLCH), 换算成 sRGB 写进 `design/tokens.json`, 再 `npm run gen:tokens` 生成 `GeneratedTokens.kt`。

| 令牌 | 浅色 | 深色 | 现状 (design/tokens.json) |
| --- | --- | --- | --- |
| background | #FDFDFD | #090A0C | #FFFFFF / #212121 |
| card | #FFFFFF | #111114 | 无 (surface 兼任) |
| muted | #F3F4F5 | #1C1D20 | surface #F4F4F4 |
| muted-fg | #666970 | #9B9EA6 | textSecondary #6B6B6B |
| accent (按压) | #EFF0F3 | #222428 | surfaceAlt #EAEAEA |
| border | #E3E4E7 | 白 9% | #E5E5E5 / #3D3D3D |
| primary | #17181B | #F1F2F3 | accent #0D0D0D |
| brand | #5D67EE | #7989FF | 无 (强调色预设 6 个) |
| danger / success / warning / info | #DF2225 / #16A356 / #F09C17 / #1289E7 | #FC5855 / #42C070 / #F5AE39 / #4BA3F7 | 有, 色值不同, 无 info |

强调色预设与 HX-UI 一致: indigo (默认), emerald, rose, amber, zinc。现有的 "主题色" 设置改为在这五个里选, 只换 brand, 中性色不动。

| 类 | 值 |
| --- | --- |
| 字号 | display 28 · title-lg 22 · title 17 · body 15 · body-sm 13 · caption 12 · micro 11 (现状写死 12 种, 10-26sp, 253 处) |
| 字重 | 400 / 500 / 600, 标题字距 -0.01 ~ -0.02em; 数字用等宽 (tabular) |
| 圆角 | sm 8 · md 10 · lg 12 · xl 16 · 2xl 22 · pill (HX-UI `--radius` 12 推出; 现状默认 16, 写死 10 种) |
| 间距 | 4 · 8 · 12 · 16 · 24 · 32; 页边距 16 |
| 控件高 | 按钮 36 (小 32) · 输入框 44 · 列表行 52 / 双行 60 · 标题栏 52 · 底栏 64 · 点按区 ≥ 48 |
| 阴影 | soft (悬浮卡) · float (抽屉, 对话框, 横幅); 平铺卡片只描边 |
| 动效 | fast 150 · base 250 · slow 500; ease-out (0.22, 1, 0.36, 1); 尊重系统 "移除动画" |

## 3. 四种容器

| 容器 | 用在 | 外观 | 返回 |
| --- | --- | --- | --- |
| 栏根页 | 五个底部栏首页 | 大标题 22, 底栏可见 | 非总览回总览, 总览退出 |
| 子页 | 有自己的列表 / 表单 / 还能往下走 | 右侧推入, **盖住底栏**, 标题栏 52 + 返回 | 退一级, 根部回来源栏 |
| 底部抽屉 | 预览, 快捷操作, 选一个 | 圆角 22, 拖手柄, 最高 78%, 可上拉全屏 | 关闭 |
| 对话框 | 只做确认或 1-2 项短输入 | 居中, 主按钮在右, 危险操作红色 | 等于取消 |

不允许: 全屏 Dialog 逐层叠 (终端这种沉浸式页面除外); 抽屉叠抽屉; 对话框里放列表; 手机上用 DropdownMenu 做长按菜单。关系图里红色 ! 就是现状违反这几条的地方。

子页盖住底栏是这次的主要变化: 微信, Telegram, 飞书, Slack, GitHub 手机端都是这样, 底栏只在根页出现, 返回语义最清楚, 也给内容多 64dp。

## 4. 导航与返回

沿用 `docs/client/android-navigation.md` 的三层规则 (叠层 → 栏内子页 → 栏), 补充:

- 再点当前栏: 回栏根页并滚到顶。
- 每个页面有深链 `hxaioa://<pages.json 里的 id>`; 通知, 新消息横幅, 分享进来都走同一个入口, 返回链路与手点一样 (由 `pages.json` 的父子关系重建)。
- 预测性返回: manifest 开 `android:enableOnBackInvokedCallback="true"`, 子页与抽屉跟手。targetSdk 升到 36 后系统默认就开, 不迁移会丢返回动画。
- 宽屏 ≥ 840dp 左侧导航栏 + 列表详情双栏, 子页在右栏打开。

## 5. 反馈, 三态, 实时

- 三态顺序固定 (对应 HX-UI `DataBoundary`): 有缓存先显示 + 顶部细进度; 没缓存骨架; 空态一句话 + 一个动作; 错误按类型 (断网, 未授权, 服务端错) 给 "重试" 或 "去设置"。
- 提示统一底部 Snackbar, 可撤销的操作带 "撤销" 5 秒; 不再用 Toast (现状 18 处)。
- 实时: 秒级推送的数据旁放绿点; 断线时全局顶部出现 "正在重连" 条, 实时数据变灰并写 "更新于 x 前"; 恢复后自动补齐, 不需要用户下拉。下拉刷新只放在 "进页拉取" 的页面。
- 未保存修改返回先问 "放弃修改?"。

## 6. 组件与插件替换

- 页面只用 `client/android/ui` 的组件: `AppScaffold` `SubPage` `Sheet` `ConfirmDialog` `InputDialog` `ListGroup` / `ListRow` (含 Nav / Switch / Info / Input / Action 五种) `Segmented` `Chip` `Badge` `LiveDot` `StateBody` `Snackbar` `Skeleton` `Card` `StatCard` `Chart` (现有 `SettingsKit` / `PageStates` 里的同类件迁进组件库, 缺的补上, 见 issue 清单)。新组件先进组件库和画廊, 再给页面用。
- 门禁 (加进 `LayoutLintTest`): `ui/` 下页面不直接用 material3 的 `AlertDialog` `ModalBottomSheet` `DropdownMenu` `Toast`; 不写 `RoundedCornerShape(数字.dp)` `fontSize = 数字.sp` `Color(0x...)`。存量按 issue 清单分批改, 每批跑画廊截图。
- 插件: 主题插件 (`core.theme.base`) 只换令牌。要换整个组件 (比如聊天气泡, 列表行), 插件注册到组件扩展点, 组件库按 "插件 > 默认" 取实现; 替换件必须通过同一组画廊截图与无障碍检查, 不通过就回退默认。

## 7. 改页面的流程

1. 改 `pages.json` (加节点, 类型, 实时级别), 运行 `gen.py`。
2. 改 `docs/client/android-navigation.md` 的入口表与 `TabNav` 用例 (原有要求不变)。
3. 只用组件库实现; 画廊里加这一页的截图。
4. 权限有变化同步 `docs/client/android-permissions.md`。

## 8. 术语

本项目有两种 "Agent", 界面文案不要只写 "Agent", 按语义写全:

- **群 Agent** (也叫 "云 Agent"): 接入某个群的 Agent, 在群里收发消息, 有名字, 头像, 可读的群, 触发方式; 群设置, 成员与群 Agent, 资料卡, @ 选择里的都是它。插件 (点子待办等) 装的也是群 Agent。
- **agent harness** (也叫 "agent loop"): 电脑上交互式的 CLI, 如 Codex, Claude Code (接入里 kind=interactive 的那类); 干完活推任务卡, 你在卡上回复, 批准或叫停。顶部标签与侧栏的 "agent harness" 页展示的是它的任务。

一个 agent harness 可以拿着接入语去当某个群的群 Agent, 这时在群里按群 Agent 显示。
