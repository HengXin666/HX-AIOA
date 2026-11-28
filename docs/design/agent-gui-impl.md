# Agent GUI 实现契约 (#126 第一期, 仅 Web)

本文是三路并行实现 (探针 / 服务端 + 协议 / Web) 的接口契约, 设计依据 [agent-gui.md](agent-gui.md) 与 [agent-gui-ui.md](agent-gui-ui.md)。改契约先改本文。

## 0. 范围

做: 探针 ACP 多路代理 (本机 / 局域网直连), 原始 ACP 日志与回放, 设备配对 (经 Hub 一次), Agent 实例 (预设 + 本地命令), Hub 会话索引与审批 (as_req / as_unreq / as_answer, 离线补, 推送), Web 工作台 (`#/agent/gui`) 工作模式 + 审批模式。

不做 (后续): 安卓, CF Tunnel / cloudflared, ACP Registry 一键安装 (先用 `npx -y <包>` 预设), checkpoint, worktree, 跨 Agent 接力, 终端标签 (右栏先只做 改动 / 文件 / 计划)。

## 1. 三道门

- key 带 `probe:agent` (protocol `SCOPES` 新增; 添加主机时可勾 "Agent")。
- 探针本地 `AIOA_AGENT=1` 才加载 `tools/probe-agent.mjs`, 并在 host info 里声明 `agent: { port, v: 1, routes }`。
- 本地开了但 key 缺 `probe:agent`: Hub 不静默删掉, host info (含离线快照) 与 `ag_hosts` 里留 `agent: { port, v, routes: [], denied: "scope" }` / `{ subject, online, routes: [], sessions: [], denied: "scope" }`; `denied` 只由 Hub 写, 有 scope 的探针自报 denied 当没声明。protocol `parseAgHostInfo` 放行 `{ denied: "scope" }` (port / v 缺省 0)。
- 补开: `POST /api/v1/probes/{id}/scope` (`PATH_PROBE_SCOPE`, 仅主账号), `{id}` = 主机名 (subject) 或 key id; 请求 `{ "add": ["probe:agent"] }` (目前只认这一项, 别的 400); 没有这台主机的 probe key 404; 回 `{ "ok": true }`。scope 存在服务端 key 记录里, key 不变, 所以不重签发, 也不回 `key` / `command` (类型里 `key?` 留作以后需要重签发时用, Web 有 key 才给重装命令); 原安装命令继续可用。改完 Hub 以 close code 4010 断开用这把 key 连着的探针, 探针 1 秒后自动重连并带上新 scope, `denied` 随之消失。
- 安装: `install.sh --agent-listen <地址:端口>` 写入 `AIOA_AGENT_LISTEN` (隐含 `--agent`), 如 `--agent-listen 0.0.0.0:7841` 开局域网。
- 只有主账号能配对, 配对要密码 (与终端票据共用 5 次错锁 5 分钟)。

## 2. 直连 (浏览器 <-> 探针)

监听: `AIOA_AGENT_LISTEN`, 默认 `127.0.0.1:7841`; 设成 `0.0.0.0:7841` 即开局域网。

HTTP:
- 所有响应带 CORS (`Access-Control-Allow-Origin: <Origin>`, `Vary: Origin`) 与 `Access-Control-Allow-Private-Network: true`; OPTIONS 预检直接 204。
- `GET /hello` -> `{ "v": 1, "host": "<subject>", "pub": <主机公钥 JWK>, "nonce": "<随机>", "agent": "hx-aioa-agent" }`。

WS: `GET /ws` (升级)。探针用 Node 内置模块自己实现 RFC 6455 服务端 (零依赖), 文本帧, 每帧一个 JSON 或 JSON 数组 (合批, 16 ms)。

握手:
```
-> 服务端先发 { "t": "challenge", "nonce": "n...", "host": "pc", "pub": JWK }
<- { "t": "hello", "device": "<设备 id>", "sig": "<base64url ECDSA P-256 SHA-256 签名(nonce)>", "fg": true }
-> { "t": "ready", "device": "d1", "host": "pc", "sessions": [SessionInfo...], "instances": [Instance...], "settings": Settings }
   签名错: { "t": "error", "code": "auth", "msg": "..." } 后关闭
```
Web 连接状态 (仅 Web 内部, 不上线): `noroute` = 主机没有路线或全被过滤 (非本机设备过滤 127.0.0.1, https 页面下 http/ws 局域网路线不可用), 显示 "此设备只能用审批模式"; `unreachable` = 可试的路线连续 3 轮都不通, 转慢速重试并引导到收件箱 (审批模式)。
设备密钥: Web 用 WebCrypto 生成 ECDSA P-256 不可导出私钥, 存 IndexedDB; 设备 id = 公钥 JWK 的 SHA-256 前 16 位 hex。签名用 WebCrypto 原生格式 (IEEE P1363, r||s 64 字节), 探针用 `crypto.verify("sha256", nonce, { key, format: "jwk", dsaEncoding: "ieee-p1363" }, sig)` 验证。

帧 (客户端 -> 探针):
```
{ "t": "attach", "sid": "s1", "since": 120 }          // since 省略 = 最近窗口 (最近 3 轮, 不超过 256 KB)
{ "t": "detach", "sid": "s1" }
{ "t": "fg", "on": true }                             // 页面前台 / 后台 (决定审批 quiet)
{ "t": "acp_out", "sid": "s1", "m": { "jsonrpc":"2.0", "id": 7, "method": "session/prompt", "params": {...} } }
    // 客户端发给 Agent 的 ACP 请求原样包一层; sessionId 由探针替换成真实 ACP sessionId; id 由探针重映射, 回包时还原
{ "t": "perm", "sid": "s1", "rid": "r1", "option": "<optionId>" | null, "text": "拒绝并说明的话" }
    // 回答权限请求; option=null 表示拒绝 (选 Agent 公布的 reject_once, 没有就 cancelled), 有 text 时拒绝后立刻把 text 作为下一条 prompt
{ "t": "hx", "id": 8, "m": "<方法>", "p": {...} }
```
帧 (探针 -> 客户端):
```
{ "t": "acp", "sid": "s1", "seq": 121, "m": <ACP 原文 JSON-RPC> }    // 双向都记: Agent 发来的 (通知, 请求, 回包) 与客户端发出的 prompt
{ "t": "window", "sid": "s1", "from": 80, "to": 121, "more": true, "items": [ { "seq": 80, "m": ... }, ... ] }   // attach / hx log/page 的回放
{ "t": "perm_req", "sid": "s1", "rid": "r1", "card": Card }         // 权限请求 (卡片已算好), 也在 acp 流里原文出现一次
{ "t": "perm_done", "sid": "s1", "rid": "r1", "by": "desktop|hub|agent", "option": "..." }   // 任一端答了 / Agent 取消了
{ "t": "session", "info": SessionInfo }                              // 会话状态变化 (建, 运行, 等你, 完成, 出错, 关闭)
{ "t": "stats", "sid": "s1", "ctx": [53000, 200000], "tps": 61, "est": true, "hit": 0.82, "cost": 0.045, "in": 0, "out": 0, "cr": 0, "cw": 0, "ms": 0 }   // 每秒最多一帧, 只发给附着者
{ "t": "hx_res", "id": 8, "ok": true, "r": {...} } / { "t": "hx_res", "id": 8, "ok": false, "err": "..." }
{ "t": "error", "code": "auth_required", "msg": "Authentication required", "methods": [AuthMethod...], "instance": "claude", "sid"?: "s1", "id": 8 }
    // session/create 或 session/resume 时 Agent 要求先登录 (ACP 错误码 -32000 或错误文本像 auth required, 且 initialize 回了非空 authMethods):
    // methods 是 initialize 的 authMethods 原样 (ACP AuthMethod: { id, name, description?, ... }); instance 总带; 恢复已有会话时带 sid (新建时没有);
    // id 是触发它的 hx 请求 id; 紧接着该 hx 请求回 ok:false。探针把那个 Agent 进程留 10 分钟等 agent/authenticate (同一实例只留最新一个)
```

`hx` 方法:
| m | p | r |
| --- | --- | --- |
| `session/create` | `{ instance, cwd, title?, mode?, model? }` | `SessionInfo` (探针启动 Agent 子进程, initialize, session/new) |
| `session/close` | `{ sid }` | `{}` (结束子进程, 会话留档) |
| `session/delete` | `{ sid }` | `{}` |
| `session/rename` | `{ sid, title }` | `SessionInfo` |
| `session/resume` | `{ sid }` | `SessionInfo` (Agent 支持 loadSession 时 session/load, 否则报错) |
| `log/page` | `{ sid, before, limit? }` | 以 `window` 帧回 (按轮往前翻) |
| `instances/list` / `instances/save` / `instances/delete` | `{}` / `Instance` / `{ id }` | `Instance[]` |
| `settings/get` / `settings/set` | `{}` / `Partial<Settings>` | `Settings` |
| `devices/list` / `devices/remove` | `{}` / `{ id }` | `Device[]` |
| `git/status` | `{ sid }` | `{ branch, files: [{ path, x, y, add, del }] }` |
| `git/diff` | `{ sid, path?, staged? }` | `{ diff }` (统一 diff 文本, 最多 512 KB) |
| `fs/tree` | `{ sid, path? }` | `{ entries: [{ name, dir, size }] }` (一层, 跳过 .git node_modules) |
| `fs/read` | `{ sid, path }` | `{ text, truncated }` (最多 256 KB) |
| `tool/output` | `{ sid, toolCallId }` | `{ content }` (工具完整原始输出, 时间线展开才取) |
| `dirs/recent` | `{}` | `{ dirs: string[] }` |
| `agent/authenticate` | `{ instance, methodId, sid? }` | 有等登录的进程: 在它上面调 ACP `authenticate { methodId }` (最长 5 分钟), 成功后重试原来的 session/new (或恢复), 回 `SessionInfo` (新建的会话此时才进列表并广播 `session`); 重试又要求登录则再发 `auth_required`。没有等登录的进程: 起临时进程 initialize + authenticate 后退出, 回 `{ authenticated: true }`, 客户端再 `session/create`。methodId 不在 authMethods 里报错 (进程仍留着可换方式) |

类型:
```ts
type Instance = { id: string; name: string; kind: "claude" | "codex" | "dsh" | "custom"; cmd: string; args: string[]; env?: Record<string,string>; model?: string; mode?: string };
// 预设 (首次启动写入, 用户可改): claude: npx -y @agentclientprotocol/claude-agent-acp; codex: npx -y @agentclientprotocol/codex-acp (CODEX_PATH 可指本机 codex); dsh: npx -y @openma/deepseek-harness-acp
// (探针实现时核实包名, 以 npm 上实际可用的为准)
type SessionInfo = { id: string; instance: string; agent: string; title: string; cwd: string; state: "starting" | "running" | "waiting" | "idle" | "error" | "closed"; created: number; updated: number; ctx?: number /* 0..1 */; pending: number; adds?: number; dels?: number; err?: string; modes?: unknown; models?: unknown; caps?: unknown };
type Settings = { watchPush: "quiet" | "none" | "normal"; quietRepushSec: number /* 60 */ };
type Device = { id: string; name: string; pub: JsonWebKey; added: number; last?: number };
type Card = {
  rid: string; sid: string; host: string; agent: string; title: string; cwd: string; branch?: string;
  at: number;                      // 请求发出时间
  tool: { kind: string; title: string; content: string /* 原样: 命令全文 / diff 前两段 / 网址, 最多 2 KB */; locations: string[] };
  goal: string;                    // 这一轮用户原话 (2 行)
  last: string;                    // Agent 最后一段话 (3 行)
  risk: "low" | "mid" | "high"; why: string[];
  changed: number;                 // 本轮已改文件数
  options: { optionId: string; kind: string; name: string }[];   // ACP PermissionOption 原样
  quiet?: boolean;
};
```

探针 ACP 客户端要点 (照 t3code 的适配器陷阱): 先 initialize 协商 `protocolVersion`, clientCapabilities 报 `fs.readTextFile / writeTextFile` 与 `terminal: true` 并实现 (fs 只允许会话 cwd 下; terminal/* 用 child_process); 任何结束路径 (子进程退出, 会话关闭) 都把未决权限请求以 `cancelled` 收尾并发 `perm_done`; 额度错误归类 `usage_limit`; 子进程环境清掉 `AIOA_TOKEN`; Agent 进程在客户端全断开后继续跑。

风险档规则 (`rules.json` 可改): 高 = rm / 删除类 kind=delete / `git push --force` / sudo / 路径含 `.env` `~/.ssh` `id_rsa` 密钥 / systemctl restart; 中 = npm|pnpm|pip|cargo install / curl wget 下载 / 写 cwd 外 / git commit / kind=fetch; 其余低。

本地文件: `~/.config/hx-aioa/agent/` 下 `host-key.json`, `devices.json`, `instances.json`, `settings.json`, `rules.json`, `sessions/index.json`, `sessions/<sid>.jsonl` (每行 `{ seq, at, dir: "in"|"out", m }`), `sessions/<sid>.turns.json` (每轮起始 seq 与字节偏移)。

## 3. 经 Hub (很少)

全部走现有探针长连 / 客户端长连帧, 不新增 Worker 请求 (配对与收件箱补拉各一个 HTTP)。

```
// 探针 -> Hub
{ "t": "ag_index", "sessions": [ { id, agent, title, state, ctx, pending, updated } ] }
    // 只在 会话增删 / state / pending / title / ctx 跨档 变化时上报 (比较时不看 updated 与顺序; git/status 的 adds/dels, mode/config 回包, usage_update 不触发);
    // ctx 只报分档下限: <50% 报 0, 其余 0.5 / 0.8 / 0.95; trailing 合并: 每次变化推后 5 秒, 离第一次变化最迟 20 秒; 变了又变回去不发;
    // Hub 只放内存, 重连 / 收到 ag_reindex 立刻全量重报; Hub 收到只有 updated 不同的索引不广播 ag_hosts
{ "t": "ag_req", "card": Card }                       // 每个权限请求都发; card.quiet 为真 = 有前台客户端附着该会话
{ "t": "ag_unreq", "sid", "rid", "by": "desktop|agent" }   // 直连端答了或 Agent 取消了; 只对发过 ag_req 的请求发 ("不推" 下没发过的不发)
    // 以探针为准: Hub 即使已按别的端收掉, 也改正 by 并重新广播 ag_unreq
{ "t": "ag_ack", "aid", "sid", "rid", "by": "hub|desktop|agent" }   // 对每个 ag_answer 的确认; hub = 这次答复生效, 否则实际由 by 答复 / 撤回
{ "t": "ag_paired", "pid": "<配对请求 id>", "ok": true, "device": Device, "pub": JWK, "routes": [Route] } / { ..., "ok": false, "err": "..." }
// Hub -> 探针
{ "t": "ag_pair", "pid": "...", "device": { id, name, pub } }
{ "t": "ag_answer", "aid": "a_x", "sid", "rid", "option": "..." | null, "text": "" }
{ "t": "ag_reindex" }   // DO 休眠醒来: 首次有客户端 welcome 时, 对内存里还没有索引的在线 Agent 探针各发一次 (每次 DO 生命周期每台一次); 探针立刻回 ag_index
// Hub -> 客户端 (只发给主账号的客户端连接)
{ "t": "ag_hosts", "hosts": [ { subject, online, routes, sessions } ] }   // 客户端连上时, 以及索引变化时
{ "t": "ag_req", "card": Card }
{ "t": "ag_unreq", "host", "sid", "rid", "by": "desktop|phone|web|agent" }   // 同一 rid 可能来第二次 (by 被探针改正), 以最后一次为准
{ "t": "ag_answered", "aid", "host", "sid", "rid", "ok": true|false, "by": "desktop|phone|web|agent" }
    // 只发给答题的那一端 (按设备): 探针 ag_ack 后回告; ok=false = 答晚了, 实际由 by 答复 / 撤回, 这端的选择没生效;
    // Hub 等 ack 只在内存 (30 秒), DO 休眠丢了就只有 ag_unreq 广播改正
// 客户端 -> Hub
{ "t": "ag_answer", "aid": "<客户端生成, 幂等>", "host", "sid", "rid", "option": "..." | null, "text": "" }
```
`Route = { kind: "local" | "lan" | "tunnel"; url: "http://127.0.0.1:7841" }` (探针在 host info / 配对回包里报)。

HTTP:
- `POST /api/agent-gui/pair` `{ subject, password, device: { id, name, pub } }` (主账号) -> Hub 校验密码 (复用 shellTicket 的错锁) -> 发 `ag_pair` 给该主机探针 -> 等 `ag_paired` (10 秒超时) -> `{ host, pub, routes, device }`。
- `GET /api/agent-gui/inbox` -> `{ cards: Card[] (未答, 按 at 升序), hosts: [...] }`, 离线回来补拉用。

Hub 存储: SQL 表 `agent_gui_req (host, rid, sid, card TEXT, state 'open'|'done', by, at, done_at)`, 主键 (host, rid); 答复或撤回置 done 并广播 `ag_unreq`; 先答先得 (第二个答复返回 `ag_unreq` 给它), 但最终以探针为准 (`ag_ack` / 探针 `ag_unreq` 可改正 by, 见上); 24 小时后清理 done 行, 7 天清理 open 行。推送: 复用现有 webpush, `quiet` 为真时发静默通知 (silent), 60 秒后探针会以 `quiet: false` 重发同一 rid (Hub 视为更新, 补一次正常推送; 卡片与 loud 标记同一次写); 已 done 的 rid 不再推。通知点进来到 `#/agent/gui/<host>/<sid>`。

## 4. Web

- 路由: `#/agent/gui` 工作台首页 (新会话页), `#/agent/gui/<host>/<sid>` 会话; `#/agent/gui/inbox` 审批模式 (收件箱)。Agent 栏首页加入口卡 "编程 (Agent GUI)"。
- 连接运行时 (`client/web/src/agentgui/`): 每主机一个连接主人, 路线按 缓存的上次成功 -> local -> lan 顺序试, 先 `GET /hello` 验主机公钥与配对时记下的一致再握手; 带抖动指数退避; 回前台先探活; `seq` 补帧; 传输健康与数据新鲜分开显示。没有任何直连路线时: 只能用审批模式 (经 Hub), 工作模式显示 "需要在这台主机上或同一局域网打开, 隧道下一期"。
- 工作台布局与交互按 agent-gui-ui.md 第 2 节; 第一期必须有: 左栏 (主机切换 + 路线标签, 新会话, 需要你, 按项目分组的会话列表 + 状态点), 时间线 (消息, 思考折叠, 工具行按 kind 图标与合并, 工作组折叠, 编辑 diff 就地展开, 命令输出展开才 `tool/output`, plan 勾选清单, 错误红条), 审批卡贴输入框上方 (四问, 原生选项, Enter / Shift+Enter / Esc, 输入框打字回车 = 拒绝并说明), 输入框 (权限模式按钮, 模型面板, `/` 斜杠命令来自 available_commands_update, 停止), 统计条 (上下文 · tok/s · 缓存 · 费用, 悬停明细), 右栏 改动 (git status / diff) / 文件 (树 + 预览) / 计划。
- 审批模式: 收件箱一屏一张卡 (头: Agent · 项目 · 等了多久 · 还有 n 个; 四问; 大按钮 允许一次, 次按钮 总是允许 / 拒绝并说明; 高风险长按 1 秒; "看全部" 跳工作模式同一位置), 下方 "进行中" 状态带 (来自 ag_hosts)。顶栏 "工作 | 审批" 切换, 记在 localStorage。数据来自 Hub (ag_req / ag_unreq / inbox), 有直连时答复走直连 `perm`, 否则走 Hub `ag_answer`。
- 设置页 (工作台左下): Agent 实例 (增改删, 预设), 已配对设备, 电脑前看着时手机 (静默推送 / 不推 / 正常推送), 配对这台主机 (输密码)。
- 组件用 HX-UI (`@hx/ui`), 样式按 ui-spec, 不写死厂商。
