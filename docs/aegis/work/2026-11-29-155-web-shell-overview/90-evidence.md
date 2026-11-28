# Web 侧栏与总览重做 (#155) - Evidence

2026-11-29, 分支 hxoa/oa_1-2f21a422。第二版: 主人嫌第一版发光, 渐变, 多色太 "AI 味", 参考弹幕守护 (BiLiBiLi_DanMu_Crawling) 的前端收敛。

## 改了什么
- 侧栏换成 HX-UI 自带 Sidebar (inset, 可收成图标栏, Ctrl+B), 图标单色, 计数用 SidebarMenuBadge; 内容区加顶栏 (收起按钮, 栏名, 连接状态, 搜索)。
- 总览: 中性卡片 (Card + CardHeader + CardDescription), 颜色只表达状态 (需要我不为 0 时变红); 五项计数, 需要我放最前, 活跃 (面积图 + 事实 + 活跃日历), 消息来源 (按群条形), 正在发生, 值得一看, 群 Agent, 资源; 1280 起 12 列, 1920 起同一行放更多块。去掉发光, 渐变, 呼吸, 流光, 玫瑰图, 4K 整页放大。
- 字体: Geist + 思源黑体可变字重 (@fontsource-variable/noto-sans-sc)。
- 手机宽度 (< 720px) 不提供网页版, 直接显示安卓 App 下载页 (ui/AppGate.tsx), 不登录也不建连接。

## 验证
| 命令 | 结果 |
| --- | --- |
| `npm run typecheck -w client/web` | 通过 |
| `npm run build -w client/web` | 通过 |
| 本地 wrangler dev + 种子数据 + playwright (暗色 ink) | 1440x900, 1920x1080, 2560x1440, 390x844 截图, 无页面错误 |

注意: 本地联调用临时 `.dev.vars`, 跑完已删除。
