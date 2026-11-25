# 翻译 (#100)

外文邮件与网页类正文的翻译。服务端只做通用的"段落翻译", 切段与回填在客户端 (有 DOM 的地方: 安卓 WebView, 以后的网页前端)。

## 服务商

- 现在: 微软 Azure Translator F0 免费层, 每月 200 万字符; 超出不会扣费, 因为服务端到停止线就不再调用。
- 不用 CF Workers AI (额度太少, 用户决定 2026-11-25)。
- 备选 (未接入): 硅基流动 tencent/Hunyuan-MT-7B (免费, 需实名), 腾讯 TokenHub hy-mt2 (按量, 很便宜)。调研记录见 issue #100。

## 配置

| 变量 | 说明 |
|---|---|
| `AZURE_TRANSLATOR_KEY` | Azure 翻译资源的密钥 (GitHub secret 同名, 部署时同步) |
| `AZURE_TRANSLATOR_REGION` | 区域资源才需要 (如 `eastasia`); 全局资源不填 |
| `TRANSLATE_MONTH_LIMIT` | 每月停止线 (字符), 默认 1800000 (F0 的九成) |

没配密钥时, 需要调用接口的请求返回 503 `TRANSLATE_OFF`; 缓存命中与不需要翻的段照常返回。

## 接口

`POST /api/v1/translate` (主人)

```json
{ "texts": ["Your <b>order</b> has shipped."], "to": "zh-Hans", "format": "html" }
```

- `texts`: 段落, 最多 100 段, 单段 5000 字符, 合计 30000 字符。
- `format=html`: 段内可带行内标签, 译文保留标签。
- 返回 `{ texts, from, cached, billed, usage }`, `texts` 与输入一一对应。

`GET /api/v1/translate/usage` → `{ month, used, limit, ready }`。

## 规则

- 跳过: 没有字母的段 (数字, 验证码, 符号), 只是链接或邮箱的段, 已是中文的段。原样返回, 不计费。
- 缓存: 按 目标语言 + 格式 + 原文 的哈希存译文, 90 天; 同一请求里重复的段只译一次。
- 计费: 按送去微软的原文字符数 (含标签) 记在本月 (UTC) 名下; 加上这次会超过停止线就整次拒绝, 返回 429 `TRANSLATE_QUOTA`。
- 客户端切段建议: 按块级元素 (p, li, td, h1-h6, div 的直接文字) 取 innerHTML; 跳过 script, style, code, pre, 隐藏元素; 译完回填原位置。
