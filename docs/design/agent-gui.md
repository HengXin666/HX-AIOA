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
| t3code | Claude 用 Agent SDK, Codex 用 `codex app-server`, 其余严格走 ACP | 取: 同样三类适配 |
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
                                                                           |- Claude 适配 (Agent SDK)
                                                                           |- Codex 适配 (app-server)
                                                                           |- ACP 适配 (DSH 等)
                                                                           '- hooks 接管 (终端里开的 claude)
```

### 2.1 主机端 agentd

- 作为探针模块 `probe-agent.mjs`, 安装时 `--agent` 打开 (主机本地开关 `AIOA_AGENT=1`), 与终端开关独立。
- 会话全文只存主机: Claude / Codex 本来就有会话存档 (可恢复), agentd 另存一份统一格式的索引与事件 (JSONL, 按会话一个文件), 用于断线补发与手机翻历史。
- 统一模型 (取自 ACP 与 t3code 词汇):
  - `host` 主机, `project` 工作目录, `session` 一条对话, `turn` 一轮 (用户一句话到 Agent 停下), `item` 一项 (消息 / 思考 / 工具调用 / 计划 / diff), `request` 等用户的事 (权限 / 提问 / 计划批准)。
  - 工具调用按种类归一: `read` `edit` `exec` `search` `fetch` `mcp` `other`, 审批卡片按种类决定显示什么。
  - 每个适配器声明能力: `steer` (运行中插话), `interrupt`, `plan`, `resume`, `fork`, `rollback`, `modes` (原生权限模式列表), `models`。
- 适配器:
  - Claude Code: Agent SDK 的流式输入, `canUseTool` 回调转成 `request`, 用户答案原样回给 SDK; `permissionMode` 只暴露 SDK 原生的几种。
  - Codex: `codex app-server` 的 JSON-RPC, 命令执行与改文件的审批请求转成 `request`。
  - ACP: `session/prompt`, `session/update`, `session/request_permission` 直接映射; DSH 若能说 ACP 就零适配。
  - hooks 接管: 终端里自己开的 `claude` 配一个 `PermissionRequest` / `Notification` / `Stop` hook, hook 调 `aioa hook` 把请求交给 agentd, 等手机答复后作为 hook 输出回给 CLI。电脑上先答了, hook 进程被结束, agentd 发 "撤回" (#57)。这样 #58 不需要 tmux send-keys, 也保留原生 TUI。

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

## 3. 审批卡片 "关键上下文" 怎么选

由 agentd 在主机上算好 (省流量, 也不用把全文发到手机), 每张卡最多这些:

1. 头: Agent, 项目, 会话标题, 等了多久。
2. 这轮要干什么: 用户这一轮的原话 (截 2 行)。
3. Agent 最后一句话 (截 3 行)。
4. 请求本体, 按工具种类:
   - `exec`: 完整命令, 工作目录, 是否联网 / 写工作区外 / 删除 (规则判断, 标风险)。
   - `edit`: 文件列表与 `+n -m`, 前两个 hunk, 其余 "看全部"。
   - `fetch` / `mcp`: 目标地址或工具名与参数摘要。
   - 计划: 计划要点 (列表), 批准 / 打回并说明。
   - 提问: 问题与选项, 可打字。
5. 选项: 原生 id 原样透传, 文案本地化; 危险的需要二次确认 (复用 `need_confirm`)。

除了审批, 控制面还推三种 "关键时刻": 一轮做完 (摘要 + 改了哪些文件), 出错 / 额度用尽 (带重置时间), Agent 等输入超过 N 分钟。

## 4. 界面

见 [2-ui.svg](agent-gui/2-ui.svg)。

- 桌面工作模式 (Web, 宽屏): 左栏会话 (按主机 / 项目分组, 状态点: 运行 / 等待 / 完成 / 出错), 中间时间线 (连续读写同一文件折叠, 工具调用一行, 点开看详情, diff 行内红绿), 底部输入框; 右栏分段: 改动 / 终端 / 文件。待审批作为时间线里的卡片, 同时顶部有计数。
- 手机工作模式 (安卓): 首页是会话列表; 进会话是单栏时间线, 顶部分段 对话 / 改动 / 终端 / 文件, 输入框贴底, 键盘上方一排快捷键 (停止, 插话, 权限模式)。
- 手机审批模式: 首页是 "待决定" 收件箱, 一张卡一个决定, 底部大按钮; 下面一条 "进行中" 状态带。通知栏直接带 允许 / 拒绝 (危险请求只能点进来)。

界面只用组件库, 页面关系按 `docs/design/ui-spec/` 登记。

## 5. 协议草案 (实现时改 `protocol/`)

主机 -> 服务端 (控制面, 落库或转推):

```json
{ "t": "as_index", "host": "pc", "sessions": [ { "id": "s1", "agent": "claude", "project": "HX-AIOA", "title": "修头像上传", "state": "running|waiting|idle|error", "updated": 0 } ] }
{ "t": "as_req", "sid": "s1", "req": { "id": "r1", "kind": "exec|edit|fetch|mcp|plan|question", "brief": { "goal": "...", "last": "...", "body": {} }, "options": [ { "id": "allow_once", "label": "允许一次" } ], "danger": false } }
{ "t": "as_unreq", "sid": "s1", "rid": "r1", "by": "host" }
{ "t": "as_turn_end", "sid": "s1", "summary": "...", "files": [ { "path": "a.ts", "add": 3, "del": 1 } ] }
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
```

审批落在现有任务模型上: `as_req` 在 Hub 里等价于 `task wait`, `as_answer` 等价于 `act`, `as_unreq` 就是 #57 要加的撤回, 已有的幂等, 二次确认, 离线排队, 推送都直接复用。

## 6. 安全

- 三道门, 与终端相同: key 需 `probe:agent`; 主机本地开关 `AIOA_AGENT=1`; 工作模式 (能发指令) 只给主账号, 每台设备首次需输密码换票据, 之后按设备记住 (可在设置里吊销)。审批模式同样只给主账号。
- 子进程环境清掉 `AIOA_TOKEN`; Agent 自己的登录凭据只在主机, 不经过服务端。
- 中继不落库, 不记录对话内容; Hub 只存待审批卡片 (已答复后 24 小时清理)。
- 不伪造权限模式: 手机上看到的模式就是 Agent 原生支持的。

## 7. 分期

1. 第一步 (最小闭环): A1 + A5 + B3 + C3。终端里照常用 Claude Code, 审批推到手机, 手机答了电脑继续, 电脑先答手机卡片消失。完成 #57 #58。
2. 第二步: A2 + B1 + B2 + C1, 桌面 Web 工作模式驱动 Claude Code。
3. 第三步: C2 安卓工作模式, A3 Codex, A4 ACP / DSH。
4. 之后: 直连路线, worktree 并行, checkpoint, 多主机。

## 8. 待定

1. DSH 是什么形态: 自己写的 Agent 还是某个 CLI? 能否说 ACP? 决定 A4 的工作量。
2. agentd 放进现有探针进程 (推荐, 复用安装与长连) 还是单独一个守护进程?
3. 工作模式数据面先走 Hub 中继 (随处可用, 估算见 2.2) 还是先做直连?
4. 第一步只做 Claude Code 是否可以?
