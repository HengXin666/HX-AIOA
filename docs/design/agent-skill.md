# 云 Agent 设计统一 (草案, #117)

讨论统一在 #117, 本文只放定下来的结论和图。

![现状](agent-skill/1-now.svg)

![重构后](agent-skill/2-target.svg)

## 已定

- 知识做成 skill, 装一次: 核心 skill 在仓库 `skills/hx-aioa/`, 插件的业务契约跟着插件放在 `plugins/<id>/skill/`。
- skill 由 hxaioa 直接从 Git 下载 (`hxaioa skill install`), 按插件版本固定, 可用 `HXAIOA_GIT_BASE` 换镜像; CF 不托管 skill。
- 提示词分两种: 接入语 (创建云 Agent 时用一次) 与触发语 (定时任务每次一句)。
- 写法遵守 hx-make-skill: L1/L2/L3 分层, 接口细节放 references 按需读, 文本过标点门禁。

## 版本: 小更新与大更新

- 每个 skill 一个版本号 `大.小`: 核心 `hx-aioa@2.5`, 插件 `todo@1.3` (plugin.json 的 `agent.skill`)。
- 小更新只升小号: 只改 skill 文本, 接入语, 触发语, 命令行大版本, 密钥权限都不变。命令行看到 `X-Aioa-Want` 只差小号, 自己从 Git 重装, 下一轮生效, 模型什么都不用执行。
- 大更新升大号: 接入语或触发语要变, 命令行大版本升级, 要新密钥或新权限, 登录方式变。命令行不自动装, 只打印固定一行; 服务端发 1 条群系统消息, App 卡片给出复制新接入语, 由主人亲手投递。
- 接入语里写明这条约定, 因为防注入的宿主只执行主人发的话。
- 上报: 命令行每个请求带 `X-Aioa-Skill`, 服务端只在版本变化时写 1 行并经已有 WS 推给 App; 应有版本搭 next 响应头下发。全部 0 额外请求。
- 门禁: `check:plugins` 对接入语模板, 触发语模板, 所需权限算 hash, hash 变了而大号没升则失败。
- 建议: 服务端对上一个大版本兼容至少 14 天。

## 待定

- 处理游标的判定: 回复覆盖 (`send --covers`) 加显式 `done` 是否够用。
- 不支持 skill 的宿主: 退化为 `hxaioa guide` 打印 SKILL.md 全文 + 简报。
