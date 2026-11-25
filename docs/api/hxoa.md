# hxoa 接入接口

内置插件 `hengxin666.hxoa` (#97)。主人启用后才有, 否则整组 404; 只有主人能调 (Agent 的 key 返回 403)。

令牌在服务端用 `TOKEN_SECRET` (没有时用 `AUTH_TOKEN`) 派生的密钥 AES-GCM 加密落库 (表 `hxoa_conn`), 任何接口都不返回令牌。服务端带令牌转发到 hxoa 的 agent 接口 (`<base>/v1/*`, 见 hxoa 的 `docs/PROTOCOL.md`)。

| 方法 路径 | 说明 |
| --- | --- |
| `GET /api/v1/hxoa` | `{conns: HxoaConn[]}`; 每条并行打一次 `/v1/hello` (5 秒超时), 连上的带 `hello` (工作区, 身份, 模式, worker 分支, 基线分支, 能否执行命令), 连不上的带 `error` |
| `POST /api/v1/hxoa` | `{name, base, token}` 新接入; 先 hello 验证, 不通返回 hxoa 的错误; 最多 20 条 |
| `PATCH /api/v1/hxoa/{id}` | `{name}` 改名 |
| `DELETE /api/v1/hxoa/{id}` | 删接入 (hxoa 上的令牌要在 hxoa 面板删) |
| `GET /api/v1/hxoa/{id}/ls?path=&depth=` | 目录, depth 最多 3; `{entries:[{p,d,b}], truncated?}` |
| `GET /api/v1/hxoa/{id}/read?path=&start=&end=` | 读文件; `{version, lines, start, end, content, binary?}` (二进制文件 content 为空, binary 为 true); 大于 512K 的文件要给行范围 |
| `POST /api/v1/hxoa/{id}/mkdir` | `{path}` 新建文件夹 (含缺的上级); `{created}`, 原来就有为 false; 需要 hxoa 2.3.0+, 旧版返回 404 |
| `POST /api/v1/hxoa/{id}/exec` | `{cmd, dir?, timeout?}`, timeout 1~60 秒 (默认 60); `{code, stdout, stderr, ms, timedOut?, truncated?}`, 输出各截到 256K |

`base` 必须是 https (本机调试可用 `http://localhost` / `http://127.0.0.1`), 不带账号和参数。hxoa 的 401 / 403 / 404 / 409 / 413 (大文件没给行范围) 原样透传, 其余错误为 502, `code` 为 `hxoa`。

停用时带 `?purge=1` 清空全部接入。
