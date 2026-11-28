# 主机安装与终端

## 一行安装探针

App "资源 → 添加主机": 填名字 (小写字母, 数字, `-`), 选是否允许终端, 服务端 `POST /api/v1/probes` 建一把只给这台机器用的 key (scope `probe`, 允许终端时加 `probe:shell`, 主体绑定名字), 返回:

```sh
curl -fsSL -A hx-aioa-agent/1 https://你的域名/install.sh | sh -s -- --server https://你的域名 --key <key> --name nas-01 [--shell]
```

- `install.sh`, `probe.mjs`, `probe-term.mjs` 由 Worker 静态资源提供 (`server/public/`, 部署时从 `tools/` 复制), 不进 Worker, 不计请求额度。
- 需要 Node 22+; 终端还需要 python3。
- `--agent` 开启 Agent GUI, 已装主机只给 `--agent` 重跑即可沿用原配置, 见 [agent-gui.md](agent-gui.md)。
- root 安装到 `/opt/hx-aioa-probe` + 系统 systemd 服务; 普通用户安装到 `~/.local/share/hx-aioa-probe` + 用户级服务 (退出登录后继续跑需要 `loginctl enable-linger`)。没有 systemd 时后台运行。
- 配置文件 `env` 权限 600。卸载: 同一条命令把参数换成 `--uninstall`, 再在 App 里删掉 key。
- 自定义 UA `hx-aioa-agent/1` 是为了不被 CF 的机器人防护拦下。

## 终端

App ⇄ Hub ⇄ 探针 原样转发字节 (base64), 探针用 python3 `pty` 开登录 shell, App 用 xterm.js (打包在 `assets/term/`, 不联网) 显示。

### 安全

三道门, 缺一不可:

1. **key 权限**: 探针的 key 必须带 `probe:shell`。没有时服务端去掉卡片上的 `shell`, 也不发票据。
2. **主机本地开关**: 探针必须以 `AIOA_SHELL=1` 启动 (安装时 `--shell`)。开关在主机上, 服务端或 App 被攻破也打不开没开的主机。
3. **每次输入密码**: 只有主账号 (role owner) 能用。`POST /api/v1/shell/ticket {subject, password}` 校验密码后发一张 60 秒有效, 绑定主体的 HMAC 票据; 连续 5 次密码错误锁 5 分钟。

另外:

- 会话 15 分钟无输入由探针断开; 每台最多 3 个会话; 任一端断线, 另一端立即收到关闭。
- 每次打开会在 "终端" 群记一条 (按规则提醒), 关闭记一条 (静默)。
- 按键与输出只转发, 不落库; 会话只记在两端连接的 attachment 里。
- 子进程环境里清掉 `AIOA_TOKEN`, shell 里拿不到探针 key。
- 终端权限 = 安装探针的用户权限, 建议用普通用户安装。

### 帧

| 方向 | 帧 |
|---|---|
| App → Hub | `{t:"term_open", sid, subject, ticket, cols, rows}` |
| Hub → 探针 | `{t:"term_open", sid, cols, rows}` |
| 探针 → App | `{t:"term_ready", sid}` |
| 双向 | `{t:"term", sid, d}` (d 为 base64, 不超过 64 KB) |
| App → 探针 | `{t:"term_resize", sid, cols, rows}` |
| 双向 | `{t:"term_close", sid, reason?}` |

端到端测试: `AIOA_SERVER=http://127.0.0.1:8799 AIOA_SETUP_CODE=<SETUP_CODE> node tools/e2e-term.mjs` (配合 `wrangler dev --local`)。
