# 翻译 (#100)

外文邮件与网页类正文的翻译。服务端只做通用的"段落翻译", 切段与回填在客户端 (有 DOM 的地方: 安卓 WebView, 以后的网页前端)。

## 服务商

- 默认 (没配微软密钥): 谷歌网页翻译的免费通道 `translate-pa.googleapis.com/v1/translateHtml`, 用组件内置的公开 key, 不用注册, 不限额。沉浸式翻译等扩展的免费谷歌翻译也是它。非公开接口, 可能限流 (返回 429) 或失效; 2026-06 起旧的 `translate_a/single?client=gtx` 已被拦。
- 可选: 微软 Azure Translator F0 免费层, 每月 200 万字符, 配了 `AZURE_TRANSLATOR_KEY` 自动切过去; 到停止线就不再调用, 不会扣费。
- 微软 Edge 的免费令牌接口 (`edge.microsoft.com/translate/auth`) 2026-08 已下线, 不用。
- 不用 CF Workers AI (额度太少, 用户决定 2026-11-25)。
- 备选 (未接入): 硅基流动 tencent/Hunyuan-MT-7B (免费, 需实名), 腾讯 TokenHub hy-mt2 (按量, 很便宜)。调研记录见 issue #100。

## 配置

| 变量 | 说明 |
|---|---|
| `AZURE_TRANSLATOR_KEY` | Azure 翻译资源的密钥 (GitHub secret 同名, 部署时同步) |
| `AZURE_TRANSLATOR_REGION` | 区域资源才需要 (如 `eastasia`); 全局资源不填 |
| `TRANSLATE_MONTH_LIMIT` | 微软通道的每月停止线 (字符), 默认 1800000 (F0 的九成) |
| `TRANSLATE_PROVIDER` | 强制通道 `azure` / `google`; 不填按有无微软密钥自动选 |

强制 `azure` 却没配密钥时返回 503 `TRANSLATE_OFF`。

## 接口

`POST /api/v1/translate` (主人)

```json
{ "texts": ["Your <b>order</b> has shipped."], "to": "zh-Hans", "format": "html" }
```

- `texts`: 段落, 最多 100 段, 单段 5000 字符, 合计 30000 字符。
- `format=html`: 段内可带行内标签, 译文保留标签。
- 返回 `{ texts, from, cached, billed, usage }`, `texts` 与输入一一对应。

`GET /api/v1/translate/usage` → `{ month, used, limit, ready, provider }`。

## 规则

- 跳过: 没有字母的段 (数字, 验证码, 符号), 只是链接或邮箱的段, 已是中文的段。原样返回, 不计费。
- 缓存: 按 目标语言 + 格式 + 原文 的哈希存译文, 90 天; 同一请求里重复的段只译一次。
- 计数: 送去翻译的原文字符数 (含标签) 记在本月 (UTC) 名下; 微软通道加上这次会超过停止线就整次拒绝, 返回 429 `TRANSLATE_QUOTA`。
- 客户端切段建议: 按块级元素 (p, li, td, h1-h6, div 的直接文字) 取 innerHTML; 跳过 script, style, code, pre, 隐藏元素; 译完回填原位置。

## 安卓邮件详情

设计稿: [mail-translate.html](../design/mockups/mail-translate.html)。界面学 QQ 邮箱, 只加一行文字入口, 不做按钮, 也不做盖在原文上的半透明遮罩。

- 入口: 识别出外文时, 发件人下面显示一行灰色小字 "英文邮件 · 翻译成中文"。语种按标题和摘要的文字类型判断 (日文 / 韩文 / 俄文 / 英文 / 外文); 中文邮件不显示这一行。点一下开始翻译, 翻译中显示 "正在翻译 · 3 / 8 段 · 取消", 翻完显示 "已译为中文 · 显示原文"。
- 译文: 标题换成中文, 原标题用小字放在下面。正文按块级标签切段, 段内保留行内标签, 送 `format=html`。第一批 12 段, 之后每批最多 100 段 / 2.8 万字符, 每批译完就填回原位置。没有正文的邮件翻摘要。纯文本样式下显示不带原文的译文。
- 对照原文: 点一下某一段展开它的原文, 再点收起 (开关, 松手不消失)。每段用 label 包住隐藏的 checkbox, 只靠 CSS, 页面不跑脚本; 点到段里的链接仍然打开链接。第一次翻完会提示一次。
- 长按那行小字打开设置: 只在我点的时候翻译 (默认) / 某语种邮件总是自动翻译 / 这个发件人不再提示。这些选择存在本机, 可在邮件设置里恢复。设置面板底部显示本月用量与当前通道。
- 缓存: 每封信的译文缓存在进程内 (最近 30 封), 切回原文再切回译文时不重新请求。
- 代码: `ui/chat/MailTranslate.kt` (切段, 语种判断, 状态), `ui/chat/MailTranslateBar.kt` (那一行小字与设置面板)。
