# Agent GUI 设计草案 (#126)

在 HX-AIOA 里遥控本机的编程 Agent (Claude Code, Codex, DSH 等), 手机与电脑都能用, 分工作模式与审批模式。本文是讨论稿, 结论以 #126 评论为准。

图:

- [1-arch.svg](agent-gui/1-arch.svg): 主机, Hub, 客户端三段与两条通道
- [2-ui.svg](agent-gui/2-ui.svg): 桌面工作模式, 手机工作模式, 手机审批模式

## 1. 调研结论

| 参考 | 做法 | 我们取舍 |
| --- | --- | --- |
| t3code | Node 服务端包住各家 CLI, Web / 桌面 / 手机都是遥控端; 执行只在拥有工作区的那台机器 | 取: 执行在主机, 客户端只遥控 |
| t3code | 适配层声明能力 (能否回滚, 能否插话, 有无计划模式), 编排和界面只看能力, 不看厂商名 | 取: 同样的能力表 |
| t3code | 第一方 Agent 用原生协议, 其余严格走 ACP, 不加厂商分支 | 取后半: 我们全部走 ACP (#126 决定) |
| t3code | 不伪造权限模式, 原生审批选项 id 原样透传, 每个请求都能拒绝 | 取 |
| t3code | 命令输出不进事件流, 客户端展开那一行才订阅; 快照里不带工具原始输出 | 取: 对 DO 额度尤其关键 |
| t3code | 事件溯源 + 发件箱 + checkpoint (隐藏 git ref) | 暂不取, 先用 Agent 自己的会话存档, checkpoint 放 E 类 |
| Orca | 手机端是瘦客户端, 镜像终端, TUI 空闲时推通知; Chat 与原生终端可互切 | 取: 通知与 "原生终端兜底"; 不取: 只靠终端镜像 |
| 本仓库 | 探针: Node 22, role=probe, `demand` 有人看才推, 终端三道门 | 取: agentd 做成探针的模块, 复用安装, key, 长连, demand |
| 本仓库 | Agent 任务协议: wait / act / ack, 危险二次确认, 离线排队 24 小时 | 取: 审批模式直接落在这套上, 补 #57 撤回 |

结论: 不另起一套服务, 主机端扩展探针, 服务端只加中继与审批队列, 客户端加一个 "Agent" 入口两种模式。

## 2. 架构

```
客户端 (Web / 安卓)  <-- WS -->  Worker + Hub DO  <-- WS (role=probe) -->  主机 agentd
                                                                           '- ACP 客户端 (唯一适配)
                                                                                |- claude-agent-acp
                                                                                |- codex-acp
                                                                                '- DSH ACP (社区版或自写插件)
```

### 2.1 主机端 agentd

- 作为探针模块 `probe-agent.mjs`, 安装时 `--agent` 打开 (主机本地开关 `AIOA_AGENT=1`), 与终端开关独立。
- 会话全文只存主机: Claude / Codex 本来就有会话存档 (可恢复), agentd 另存一份统一格式的索引与事件 (JSONL, 按会话一个文件), 用于断线补发与手机翻历史。
- 统一模型 (取自 ACP 与 t3code 词汇):
  - `host` 主机, `project` 工作目录, `session` 一条对话, `turn` 一轮 (用户一句话到 Agent 停下), `item` 一项 (消息 / 思考 / 工具调用 / 计划 / diff), `request` 等用户的事 (权限 / 提问 / 计划批准)。
  - 工具调用按种类归一: `read` `edit` `exec` `search` `fetch` `mcp` `other`, 审批卡片按种类决定显示什么。
  - 每个适配器声明能力: `steer` (运行中插话), `interrupt`, `plan`, `resume`, `fork`, `rollback`, `modes` (原生权限模式列表), `models`。
- 适配: **全部走 ACP** (#126 评论 2 拍板)。agentd 只实现一个 ACP 客户端, 每种 Agent 是一行启动命令:
  - Claude Code: `claude-agent-acp` (Zed 维护, 基于 Agent SDK)。
  - Codex: `codex-acp` (Zed 维护)。
  - DSH (DeepSeek Harness): 官方 `dsh --profile acp` 只做自动化, 不给计划, 思考, 终端, 模式, 用量; 工作台用社区的 `@openma/deepseek-harness-acp` (完整 ACP 词汇, 含 usage_update 与每轮用量), 或我们自己写一个 dsh 插件 (DSH 是 cordis 插件体系, 加一个很容易)。
  - 以后任何 ACP Agent (Gemini CLI, OpenCode, Kiro ...) 零代码接入, 只加启动命令。
  - 工具种类直接用 ACP 的 `ToolKind` (read edit delete move search execute think fetch other), 审批选项直接用 ACP 的 `PermissionOption` (allow_once allow_always reject_once reject_always), 不自己发明。
  - 能力表来自 ACP 的 `initialize` 与会话配置 (`config_option_update`, `available_commands_update`), 没公布的功能界面就不显示, 不伪造。
- 例外 (可选, 不是适配器): 终端里自己开的 `claude` 不走 ACP, 只能用 hooks 把审批转到手机 (见 4.6)。GUI 里新开的会话都走 ACP。

### 2.2 两条通道

| | 控制面 (审批模式只用它) | 数据面 (工作模式才开) |
| --- | --- | --- |
| 内容 | 会话索引, 状态变化, 待审批, 一轮结束摘要 | 流式消息, 工具调用, diff, 命令输出, 文件 |
| 路径 | agentd -> Hub (落库: 只存待审批与会话索引) -> 推送 | agentd <-> Hub 中继 <-> 客户端, 不落库 |
| 何时有流量 | 状态变了才发 | 有客户端订阅这个会话才推 (`demand`), 合批 200 ms |
| 离线 | 待审批排队, 推送唤醒 | 断线重连按 `seq` 从主机补 |

额度估算 (免费额度每天 DO 请求 10 万, 行写入 10 万; WS 入站按 20:1 计费):

- 审批模式: 一次审批约 4 次 DO 请求 (请求, 用户回答, 下发, 撤回 / 回执), 落库 2 行。按每天 100 轮, 200 次审批估: 约 1,000 次请求, 400 行写入, 都在 1% 左右。
- 工作模式中继: 正在输出时合批后约 5 帧/秒, 1 小时 1.8 万帧, 计费约 900 次请求; DO 一直醒着, 128 MB 约 460 GB-s/小时 (免费 13,000 GB-s/天, 约 28 小时)。可用, 但时长是主要成本, 所以:
  - 只推正在看的会话, 页面切走或锁屏 30 秒后停推;
  - 命令输出, 文件内容, 完整 diff 只在展开时按需取, 不进流;
  - 后续加 "直连路线" (主机自己的隧道 / 局域网), 客户端能连上就绕开 DO, 连不上回退中继 (E 类)。

### 2.3 两种模式

同一份数据, 两种投影, 区别在订阅范围:

| | 工作模式 | 审批模式 |
| --- | --- | --- |
| 订阅 | 控制面 + 当前会话数据面 | 只有控制面 |
| 看得到 | 完整时间线, 工具调用详情, diff, 终端, 文件树, 输入框 (模型, 权限模式, 思考深度, 附件, 停止 / 插话 / 排队) | 每条待决定事项一张卡; 各会话一行状态 |
| 能做 | 一切 | 允许一次 / 本会话都允许 / 拒绝并说明 / 回一句话 / 停止; 计划批或打回 |
| 默认 | 电脑 | 手机 |

切换: 设备记住默认值, 页面顶部一键切; 审批卡片上 "看全部" 直接打开工作模式并定位到这一项。

## 3. 实时统计: 速率, 缓存命中, 上下文占用

ACP 能给什么 (2026-11 规范):

| 指标 | ACP 来源 | 实时性 | claude-agent-acp | codex-acp | DSH (社区 ACP) |
| --- | --- | --- | --- | --- | --- |
| 上下文占用 | `usage_update` 的 `used` / `size` (稳定) | 每步更新 | 有 | 有 | 有 |
| 累计费用 | `usage_update.cost` (稳定, 可选) | 每步 | 有 (美元) | 无 | 待验证 |
| 本轮 token 明细 (输入, 输出, 缓存读, 缓存写, 思考) | `session/prompt` 返回的 `usage` (草案, 不稳定) | 一轮结束 | 有 | 只有 token | 有 |
| 解码速率 tok/s | 无 | | | | |
| 5h / 7d 额度 | 无 | | | | |

做法:

- **上下文占用**: 直接用 `usage_update`, 显示 `占用 26% (53k / 200k)`, 超过 80% 变色并提示压缩。
- **缓存命中率**: 一轮结束按 `缓存读 / (输入 + 缓存读 + 缓存写)` 算本轮与会话累计; 一轮内显示上一轮的值。DeepSeek 的缓存命中 (`prompt_cache_hit_tokens`) 若社区 ACP 没透出, 在我们自写的 dsh 插件里放进 `_meta` (见下)。
- **tok/s**: agentd 在主机上算, 不经过 Agent。消息与思考的流式块到达时按字数估 token (中文按字, 英文按 4 字符 1 token), 只计活跃输出时间 (剔除首字等待与工具执行间隙, 同 t3code-enhancer 口径), 每秒更新一次, 显示 `约 61 tok/s`; 一轮结束用真实 `outputTokens / 活跃时长` 校准, 去掉 "约" 字, 并记下该模型的估算系数, 下一轮估得更准。
- **逐步精确值 (可选增强)**: ACP 允许在任何消息里带 `_meta`。我们约定一个命名空间 `hx.aioa/step`, 每次模型调用结束带 `{input, output, cacheRead, cacheWrite, ms}`; 有它就用它, 没有就退回上面的估算。DSH 自写插件一定带; Claude / Codex 不改上游, 不带。
- **额度 (5h / 7d)**: ACP 没有, 只能读各家的本机接口, 违背 "全部 ACP", 先不做, 放 E 类。

统计只在主机算好再发, 1 秒最多一帧, 且只发给正在看这个会话的客户端; 审批模式只收每个会话的上下文占比 (状态变化时带上)。

## 4. 审批模式设计

工作模式照搬 t3code / Orca 就够了, 审批模式是我们自己的东西, 目标: **10 秒内在手机上做对一个决定, 并且不用担心漏掉。**

### 4.1 卡片: 一张卡回答四个问题

| 问题 | 卡上写什么 | 来源 |
| --- | --- | --- |
| 它想干什么 | 动作一句话 (运行命令 / 改 3 个文件 / 访问网址) + 原样内容 (命令全文, diff 前两段, 网址) | ACP `ToolCall` 的 `kind`, `title`, `content` (diff / terminal), `locations` |
| 为什么 | 这一轮用户的原话 (2 行) + Agent 最后一段话 (3 行) | agentd 本地会话记录 |
| 影响多大 | 风险档与理由 (见 4.2), 工作目录与分支, 本轮已改文件数 | agentd 规则 |
| 我能怎么答 | Agent 原生给的选项, 外加 "拒绝并说明" 与 "看全部" | ACP `PermissionOption` |

"拒绝并说明": ACP 的拒绝不带理由, 所以先答 `reject_once`, 紧接着把说明作为一条用户消息发进会话 (Agent 在下一步就能看到)。

### 4.2 风险档 (主机规则判断, 可在设置里改)

| 档 | 例子 | 手机上怎么答 |
| --- | --- | --- |
| 低 | 读文件, 搜索, 工作区内改文件, 跑测试 / 构建 / lint | 通知栏直接点 |
| 中 | 装依赖, 联网下载, 改工作区外文件, `git commit` | 点进卡片答 |
| 高 | 删除 (`rm -r`, `delete` 类), `git push --force`, `sudo`, 读写密钥 / `.env` / `~/.ssh`, 关机 / 重启服务 | 点进卡片, 长按确认 (复用 `need_confirm`) |

规则只决定 "怎么答", 不替用户答: 不做自动放行, 想少被打扰就用 Agent 原生的 "本会话都允许" (allow_always) 或在工作模式切权限模式。

### 4.3 收件箱排序与合并

- 按 "Agent 因此停着多久" 排, 等得越久越靠前; 同一会话的请求挤在一起。
- 同一会话连续几个同类低风险请求 (如连读 5 个文件) 合成一张卡, 一次答完, 回给 Agent 时仍逐个回答。
- 一个会话一次只露出最前面的那张, 后面的显示 "还有 2 个"。

### 4.4 别漏掉, 也别吵

- 新请求立刻推送; 5 分钟没答再推一次; 之后不再推, 收件箱红点保留。免打扰时段只推高风险。
- 任一设备先答, 其它设备的卡片与通知立刻消失, 显示 "已在电脑上处理" (幂等 `aid`, 撤回帧)。
- Agent 自己取消了请求 (用户在电脑上 Esc, 或请求被后续步骤取代), 卡片自动撤回。
- 答复后 5 秒内可撤销 (还没发给 Agent 时), 防误触。

### 4.5 除了权限, 还推哪些 "关键时刻"

| 时刻 | 卡片 | 快捷回复 |
| --- | --- | --- |
| 一轮做完 | 一句总结, 改了哪些文件 (+n -m), 用时, 本轮 token 与缓存命中 | 继续 / 跑测试 / 提交 / 自定义 |
| 计划待批 (ACP `plan` 且 Agent 停下等) | 计划条目 | 批准 / 打回并说明 |
| Agent 提问 | 问题与选项 | 选项或打字 (支持语音输入) |
| 出错 / 额度用尽 | 错误一行, 重置时间 | 重试 / 换模型 |
| 上下文超过 80% | 当前占用 | 压缩 (若 Agent 公布了 `/compact` 命令) |

### 4.6 终端里开的 Claude Code (可选)

不走 ACP 的会话只能用 hooks: `PermissionRequest` hook 调 `aioa hook`, 卡片与上面相同但没有 "为什么" 一栏的 Agent 原话 (hook 拿不到), 手机答复作为 hook 输出; 电脑上先答, hook 被结束, 卡片撤回。也可以在 GUI 里用 ACP `session/load` 接着这条会话继续。

## 5. 工作模式功能清单 (对标 t3code / t3code-enhancer / Orca, 照搬)

| 区域 | 功能 | ACP 依赖 |
| --- | --- | --- |
| 侧栏 | 按主机 / 项目分组的会话, 状态点 (运行 / 待确认 / 完成 / 出错), 搜索, 新会话 (选主机, 目录, Agent, 分支 / worktree) | `session/list` |
| 新会话页 | 欢迎语 + 吸底输入框 + 环境 / 项目 / 分支切换条 | `session/new` |
| 时间线 | Markdown 消息, 思考折叠, 工具调用一行一条, 同文件连续读写合并 (`x N`), 父子折叠, 计划卡, 行内红绿 diff, 终端输出 (展开才取) | `session/update` 各类型 |
| 输入框 | `+` 附件 (文件, 目录, 图片, 工作区文件), 斜杠命令, 模型面板 (搜索), 思考深度滑块, 常驻权限模式按钮, 发送 / 运行中插话 / 排队 / 停止 | `available_commands_update`, `config_option_update`, `session/set_mode`, `session/cancel` |
| 底栏统计 | 上下文占比, tok/s, 悬停看累计 token, 费用, 本轮用时, 缓存命中率 | 见第 3 节 |
| 右栏 | 改动 (所有更改 / 已改文件 / 所有文件 三段), 终端, 文件预览, 浏览器预览 (E 类) | agentd 自己读 git 与文件, 不靠 ACP |
| 会话操作 | 重命名, 恢复, 删除, 分叉 (Agent 支持时) | `session/load`, `session/resume`, `session/delete`, `session/fork` |
| 多窗 | 右栏标签拖出浮窗, 主对话与工作区左右互换 | 纯前端 |
| 手机 | 同一套, 单栏 + 顶部分段 (对话 / 改动 / 终端 / 文件), 键盘上方快捷条 | 同上 |

不照搬: Electron 托盘 (我们是 Web 与安卓), 去遥测 (我们不接遥测), 额度双环 (ACP 没有)。

## 6. 协议草案 (实现时改 `protocol/`)

主机 -> 服务端 (控制面, 落库或转推):

```json
{ "t": "as_index", "host": "pc", "sessions": [ { "id": "s1", "agent": "claude", "project": "HX-AIOA", "title": "修头像上传", "state": "running|waiting|idle|error", "updated": 0 } ] }
{ "t": "as_req", "sid": "s1", "req": { "id": "r1", "kind": "permission|plan|question", "tool": { "kind": "execute", "title": "...", "content": [] }, "brief": { "goal": "...", "last": "...", "body": {} }, "options": [ { "optionId": "...", "kind": "allow_once", "name": "允许一次" } ], "risk": "low|mid|high", "why": ["..."] } }
{ "t": "as_unreq", "sid": "s1", "rid": "r1", "by": "host" }
{ "t": "as_turn_end", "sid": "s1", "summary": "...", "files": [ { "path": "a.ts", "add": 3, "del": 1 } ], "usage": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }, "ms": 0 }
```

客户端 -> 服务端 -> 主机:

```json
{ "t": "as_answer", "aid": "a_x", "sid": "s1", "rid": "r1", "option": "allow_once", "text": "", "confirm": true }
{ "t": "as_demand", "sid": "s1", "since": 120 }
{ "t": "as_input", "sid": "s1", "text": "...", "mode": "send|steer|queue" }
{ "t": "as_ctl", "sid": "s1", "op": "interrupt|new|resume|set", "args": {} }
{ "t": "as_fetch", "sid": "s1", "what": "diff|output|file", "ref": "..." }
```

主机 -> 客户端 (数据面, 经中继, 不落库):

```json
{ "t": "as_ev", "sid": "s1", "seq": 121, "items": [ { "id": "i9", "kind": "msg|think|tool|plan|diff", "op": "add|patch|end", "data": {} } ] }
{ "t": "as_stats", "sid": "s1", "ctx": [53000, 200000], "tps": 61, "est": true, "hit": 0.82, "cost": 0.045 }
```

`as_stats` 每秒最多一帧, 只发给订阅了该会话的客户端; 审批模式只在 `as_index` 里带 `ctx`。ACP 原始 `session/update` 在主机翻成 `as_ev`, 字段尽量沿用 ACP 名字, 客户端渲染器按 ACP 类型写, 以后换 Agent 不动界面。

审批落在现有任务模型上: `as_req` 在 Hub 里等价于 `task wait`, `as_answer` 等价于 `act`, `as_unreq` 就是 #57 要加的撤回, 已有的幂等, 二次确认, 离线排队, 推送都直接复用。

## 7. 安全

- 三道门, 与终端相同: key 需 `probe:agent`; 主机本地开关 `AIOA_AGENT=1`; 工作模式 (能发指令) 只给主账号, 每台设备首次需输密码换票据, 之后按设备记住 (可在设置里吊销)。审批模式同样只给主账号。
- 子进程环境清掉 `AIOA_TOKEN`; Agent 自己的登录凭据只在主机, 不经过服务端。
- 中继不落库, 不记录对话内容; Hub 只存待审批卡片 (已答复后 24 小时清理)。
- 不伪造权限模式: 手机上看到的模式就是 Agent 原生支持的。

## 8. 分期

1. 第一步 (闭环): agentd + ACP 客户端 + `claude-agent-acp`; 控制面审批 (含 #57 撤回); 审批模式 (安卓 + Web); Web 工作模式先做时间线, 输入框, 统计。
2. 第二步: 工作台补齐 (改动 / 终端 / 文件, 合并折叠, 多窗); 安卓工作模式; `codex-acp`; DSH。
3. 之后: 终端 claude 的 hooks 接管 (#58), 直连路线, worktree 并行, checkpoint, 多主机, 额度。

## 9. 待定

1. DSH 先用社区的 `@openma/deepseek-harness-acp`, 缓存命中等逐步数据不够再写自己的 dsh 插件 (带 `_meta`), 可以吗?
2. agentd 放进现有探针进程 (推荐, 复用安装与长连) 还是单独一个守护进程?
3. 工作模式数据面先走 Hub 中继 (推荐, 随处可用, 估算见 2.2) 还是先做直连?
4. 终端里自己开的 Claude Code (#58 原需求) 还要不要, 还是以后都从 GUI 开?
