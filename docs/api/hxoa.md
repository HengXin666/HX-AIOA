# hxoa 管理接口

内置插件 `hengxin666.hxoa` (#97, #104)。主人启用后才有, 否则整组 404; 只有主人能调 (Agent 的 key 返回 403)。

每条接入存 hxoa 的**管理令牌** (`hxadm_` 开头, 在 hxoa 面板 "远程管理" 里建, hxoa 2.4.0+), 在服务端用 `TOKEN_SECRET` (没有时用 `AUTH_TOKEN`) 派生的密钥 AES-GCM 加密落库 (表 `hxoa_conn`, `kind = admin`), 任何接口都不返回它。服务端带它转发到 hxoa 的 `<base>/admin/v1/*` (见 hxoa 的 `docs/PROTOCOL.md`)。

| 方法 路径 | 说明 |
| --- | --- |
| `GET /api/v1/hxoa` | `{conns: HxoaConn[]}`; 每条并行打一次 `/admin/v1/hello` (5 秒超时), 连上的带 `hello` (`server`, `admin`, `publicUrl`), 连不上的带 `error`; `kind` 为 `agent` 的是 #97 旧版存的工作区令牌, 只能删除重接 |
| `POST /api/v1/hxoa` | `{name, base, token}` 新接入, token 必须是管理令牌; 先 hello 验证; 最多 20 条 |
| `PATCH /api/v1/hxoa/{id}` | `{name}` 改名 |
| `DELETE /api/v1/hxoa/{id}` | 删接入 (管理令牌要在 hxoa 面板删) |
| `GET /api/v1/hxoa/{id}/state` | `HxoaState`: `server`, `publicUrl`, `tunnel?`, `workspaces` (含连接令牌的身份名, 在线, 最近访问, 操作数, worker 状态; **不含**令牌密钥) |
| `GET /api/v1/hxoa/{id}/browse?path=` | 目录选择: `{path, parent, dirs, git}`, path 为空时是 hxoa 用户的家目录 |
| `POST /api/v1/hxoa/{id}/mkdir` | `{parent, name}` 在 parent 下新建一个文件夹 → `{path}` |
| `POST /api/v1/hxoa/{id}/workspaces` | `{name?, path, workers?, exec?}` 添加工作区 (exec 默认 true) → `{id}` |
| `PATCH /api/v1/hxoa/{id}/workspaces/{ws}` | `{name?, workers?, exec?}` |
| `DELETE /api/v1/hxoa/{id}/workspaces/{ws}` | 删除工作区 (它的连接令牌一并失效) |
| `POST /api/v1/hxoa/{id}/workspaces/{ws}/tokens` | `{label}` 新建连接令牌 → `{token, prompt}`, prompt 就是要发给 AI 的连接提示 |
| `GET /api/v1/hxoa/{id}/tokens/{tok}/prompt` | `{prompt}` 连接提示 (含令牌) |
| `POST /api/v1/hxoa/{id}/tokens/{tok}/merge` | 合并该连接的 worker 分支 → `{output}` |
| `DELETE /api/v1/hxoa/{id}/tokens/{tok}` | 删除连接令牌 |

`base` 必须是 https (本机调试可用 `http://localhost` / `http://127.0.0.1`), 不带账号和参数。`{ws}` / `{tok}` 只收十六进制 id。hxoa 的 400 / 401 / 403 / 404 / 409 / 429 原样透传 (错误信息带 `hxoa <状态>:` 前缀), 其余为 502, `code` 为 `hxoa`; 旧版接入的操作返回 409。

停用时带 `?purge=1` 清空全部接入。
