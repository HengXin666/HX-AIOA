# 插件索引仓库模板

把多个插件市场的稳定版本收进一个仓库, HX-AIOA 只加这一个源, 列表和详情只拉一次索引。

## 用法

1. 用这个目录新建一个仓库 (例如 `HengXin666/aioa-plugin-index`), 在 App 的 "插件市场 → 市场源" 里加它的链接。
2. 各市场的作者把要上架的插件目录 (`<id>/plugin.json`, 介绍, 提示词) 原样拷进来, 在 `index.json` 加一条, 提 PR。只收稳定版本。
3. PR 合并前 CI 会检查:
   - 清单格式, 目录名与 id 一致, 介绍和提示词文件都在
   - `index.json` 不重复, 字段齐全, 版本与清单一致, 内嵌清单同步 (`npm run build:index` 生成)
   - 改了插件目录就必须升版本, 版本不能倒退
   - 依赖不成环, 每个插件连同依赖能单独装上, 冲突与每日请求估算
   - 命名空间: 新插件 id 用 `<GitHub 登录名>.<名字>`, 只能改自己命名空间的插件 (维护者例外, 见 `MAINTAINERS`)
4. 合并到 main 后, 各部署最迟 30 分钟看到新版, 管理员放行后生效。

## 目录

```
index.json          插件列表, 每条可内嵌 manifest
<id>/plugin.json    清单
<id>/README.md      介绍 (或 .html)
<id>/prompt.md      提示词
```

检查脚本来自 HX-AIOA 仓库 (`tools/check-plugins.ts`, `tools/build-index.ts`), CI 里临时拉取, 不用拷进来。
