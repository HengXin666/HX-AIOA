# Agent GUI: 本地上手

在自己的电脑上用网页驱动 Claude Code / Codex / DSH (#126)。设计与契约见 [design/agent-gui.md](../design/agent-gui.md), [design/agent-gui-impl.md](../design/agent-gui-impl.md)。

Web 里随时可以打开 "Agent → 编程 → 左栏 使用指引" (`#/agent/gui/guide`), 它按当前状态标出卡在哪一步; 新会话页在没就绪时也只显示当前这一步。

## 1. 要装什么

在要跑 Agent 的那台电脑上:

- Node.js 22+ (`node -v`); DSH 适配器要求 22.15+。
- 至少一个已登录, 在终端里能正常用的 Agent, 登录要用跑探针的同一个用户:
  - Claude Code: 运行 `claude`, 在里面输入 `/login`
  - Codex: `codex login`
  - DSH: 先装好 `dsh`, 在终端里能正常对话 (登录或配好 key)
- ACP 适配器不用装: 探针第一次启动某个 Agent 时用 `npx -y` 自动下载 (`@agentclientprotocol/claude-agent-acp`, `@agentclientprotocol/codex-acp`, `@openma/deepseek-harness-acp`), 可能要几分钟, 之后走 npx 缓存。

## 2. 装探针并开启 Agent

### 新主机

App "资源 → 添加主机": 填名字, "Agent" 开关默认打开 (key 带 `probe:agent`), 复制生成的一行命令到那台电脑运行:

```sh
curl -fsSL -A hx-aioa-agent/1 https://你的域名/install.sh | sh -s -- --server https://你的域名 --key <key> --name pc --agent
```

- `--agent`: 下载 `probe-agent*.mjs`, env 里写 `AIOA_AGENT=1`。
- `--agent-listen <地址:端口>`: 直连监听地址, 默认 `127.0.0.1:7841` (隐含 `--agent`)。
- 安装位置, systemd 服务与卸载同 [terminal.md](terminal.md)。

### 已装的主机

开 Agent 要两样: key 带 `probe:agent`, 主机上 `AIOA_AGENT=1` 并有 `probe-agent*.mjs`。

1. key 加权限: 使用指引 "在已装的主机上开启 Agent" 里点 "加 probe:agent" (或主机卡上 "补上权限")。key 不变, 探针重连后生效。
2. 在那台电脑上, 用当初安装探针的用户重跑安装, 只给 `--agent`:

   ```sh
   curl -fsSL -A hx-aioa-agent/1 https://你的域名/install.sh | sh -s -- --agent
   ```

   不带 `--key` 时 `install.sh` 沿用已装的 env (server, key, 名字, 终端开关, 监听地址, 其它自定义变量), 下载 Agent 模块并重启服务。以 root 装的 (`/opt/hx-aioa-probe`) 把 `sh` 换成 `sudo sh`。没有 systemd 时会先停掉之前后台跑的探针。

只改 env 里的 `AIOA_AGENT=1` 不够, 还缺 `probe-agent*.mjs`, 所以请用上面的命令。不登录那台电脑, 在 Web 上一键远程开启见 #163。

主机开了 Agent 但 key 缺权限时, 主机卡与 Agent GUI 会显示 "此主机开了 Agent 但密钥缺 probe:agent 权限", 点 "补上权限" 即可。

## 3. 配对

在装了探针的那台电脑上用浏览器打开 App → Agent → 编程, 设置 (或使用指引) 里选主机, 输入主账号密码, 点 "配对"。

- 只经 Hub 一次, 之后浏览器直连探针 (`ws://127.0.0.1:7841`), 工作数据不经过 Hub。
- 本期只有本机直连: 其它设备打开时显示 "只能审批"。局域网 (`--agent-listen 0.0.0.0:7841`) 从 https 页面连不了 `ws://`, 要等隧道。
- 设置 → 已配对设备 可以删掉某台设备。

## 4. 新会话

新会话页: 选主机, 项目目录, Agent 实例 (首次启动探针写入 Claude Code / Codex / DSH 三个预设, 设置里可加自定义 ACP 命令与环境变量), 可选模型与权限模式, 发第一条消息就开始。

- 第一次用某个 Agent 会提示 "首次启动正在下载适配器"。
- Agent 没登录时会出 "还没登录" 卡: Agent 公布了登录方式就直接点; 否则按上面第 1 节在终端里登录后再试。
- 会话在探针上跑, 关掉网页也继续; 快捷键 Ctrl+N 新会话, Ctrl+[ / Ctrl+] 切换会话。

## 5. 审批

- 权限模式用 Agent 自己公布的 (默认, 自动改文件, 计划等), 会话输入框旁切换, Ctrl+Shift+A 轮换; 不伪造, 不自动放行。
- Agent 要权限时出审批卡: 允许一次 / 总是允许 / 拒绝 / 拒绝并说明。风险档 (低, 中, 高) 只决定在哪答, 不替你答。
- 顶栏 "工作 | 审批" 切到收件箱; 任一端答了其它端立即撤回。
- 电脑前看着时手机默认静默推送, 60 秒没人答再正常推一次; 设置 → "电脑前看着时手机" 可改为不推或正常推送。

## 6. 手机

本期手机只能审批: 在收件箱里答请求, 看不了完整会话也开不了会话。配对与开会话在电脑上做。

## 7. 和 t3code 的区别

t3code 要在本机另起一个本地服务 (它的 server), 再用浏览器或桌面端连。这里不用: 探针就是本地后端, 和资源监控, 终端是同一个进程, 同一套安装与 key; Hub 只负责配对与转发审批, 工作模式浏览器直连探针。
