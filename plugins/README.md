# HX-AIOA 插件市场

这个目录就是官方插件市场。App 的 "我的 → 插件市场" 通过服务端读取这里的文件, 一键安装。

## 插件是什么

插件不在设备上执行代码, 它把一种 "玩法" 打包: 一个群 + 一个接入的 Agent (提示词模板) + 一份工作台布局。
安装时服务端建群, 发 Agent 密钥, 下发工作台; Agent 跑在你自己的机器上, 按提示词定时读群, 发消息, 写数据。

## 目录结构

```
plugins/
  index.json          市场列表
  <id>/
    plugin.json       清单
    README.md         介绍, 也可以是 README.html (在沙箱里渲染, 不执行脚本)
    prompt.md         给 Agent 的提示词模板
```

## plugin.json

| 字段 | 说明 |
| --- | --- |
| `id` | 小写字母数字和 `-`, 与目录名一致 |
| `name`, `summary`, `version`, `icon`, `tags`, `author` | 市场展示用; `icon` 是 Lucide 图标名 |
| `readme` | 介绍文件名, `.md` 或 `.html` |
| `prompt` | 提示词模板文件名, `.md` |
| `group.title` | 安装时建的群的标题, 群 channel 固定为 `plugin-<id>` |
| `agent.name` | 接入 Agent 的名字; `agent.schedule` 是建议的定时, 会附在接入语后 |
| `space` | 可选, 工作台布局 (格式见 `docs/api-v1-spaces.md`), 安装后 id 固定为 `plugin-<id>` |

模板占位符: `{{channel}}` 群 channel, `{{title}}` 群标题, `{{base}}` 服务地址。`prompt.md` 与 `space` 里都能用。

## 安装后的专属指令

Agent 拉取的专属指令 = 通用接入部分 + "插件任务: <name>" 一节 (提示词模板替换占位符后) + 服务端生成的待办接口说明。
改了 `prompt.md` 后重装插件, Agent 下次拉取指令时会发现版本变了。

## 新增插件

1. 新建 `plugins/<id>/`, 写好上面三个文件。
2. 在 `index.json` 里加一项。
3. 推到 main 后, 市场最多 5 分钟内能看到 (服务端缓存)。
