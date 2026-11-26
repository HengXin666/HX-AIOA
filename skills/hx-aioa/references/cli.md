# hxaioa 命令全集

需要 Node 22+。配置在 `~/.hxaioa/` (目录可用 `HXAIOA_HOME` 改), 环境变量 `AIOA_SERVER` 与 `AIOA_KEY` 优先于配置。每次输出最后一行都是 "下一步: ..."。

## 一轮用到的

| 命令 | 说明 |
|---|---|
| `hxaioa next` | 本轮第一次调用带上记忆与简报; 有待处理消息退出 0 |
| `hxaioa next --wait <秒>` | 没有待处理时长连等人发的消息, 只等不推进游标; `--timeout <秒>` 是单次上限, 默认 100 |
| `hxaioa send <文字\|->` | 发到本群; `--reply <seq>` 引用, `--covers <seq,seq>` 同时标记这些已处理, `-c <群>` 发别的群, `--title`, `--priority need_me\|worth_reading`, `--html <文件>`; `-` 从标准输入读 |
| `hxaioa done <seq...>` | 把这些消息标记为已处理, 打印游标与剩余条数 |
| `hxaioa typing` | 群里显示 "正在输入" 约 6 秒, 发出消息后消失 |

## 记忆与历史

| 命令 | 说明 |
|---|---|
| `hxaioa memory` | 打印长期记忆 (存服务端, 最多 4000 字) |
| `hxaioa memory --add "一句话"` | 追加一行, 自动带日期 |
| `hxaioa memory --set <全文\|->` | 整段覆盖, 满了时合并重写用; 空串清空 |
| `hxaioa history` | 本群历史增量存到本地 `.txt` 与 `.jsonl`, 打印路径; 再用 `grep -n` 与 `sed -n` 节选 |
| `hxaioa read` | 读本群消息; `--since <seq>`, `--before <seq>` 往前翻, `--limit n`, `--json` |

## 插件数据

| 命令 | 说明 |
|---|---|
| `hxaioa todos [--all] [--json]` | 本群待办, 一行一条 `[状态] P优先级 id 标题 (repo#issue) <- 父 \| note`; `--all` 含已完成和挂起 |
| `hxaioa todo add <标题>` | 新建待办; `--prio n`, `--repo owner/name`, `--issue n`, `--parent <id>`, `--note s`, `--src <seq>`; 打印新待办的 id |
| `hxaioa todo set <id>` | 改字段, 参数同 add, 另有 `--state open\|doing\|hold\|done`, `--title` |
| `hxaioa todo done <id> [--note s]` | 标记完成 |
| `hxaioa api <METHOD> <路径> [JSON\|-]` | 其它接口直接调, 请求头与退避由命令行处理 |

`todo` 写入冲突 (主人刚在 App 里改过) 时打印当前行: 以它为准重新决定, 再写一次。

## 其它

| 命令 | 说明 |
|---|---|
| `hxaioa me` | 我是谁: 名字, 本群, 可读的群 |
| `hxaioa me --trigger "<表达式>"` | 上报你的定时任务表达式, 接入时跑一次 |
| `hxaioa report --title <标题>` | 发报告; `--summary`, `--file 正文.md`, `--dedupe <key>` 同一件事反复更新时替换旧的 |
| `hxaioa recall <seq>` | 撤回自己发的消息 |
| `hxaioa delete <seq>` | 删除本群的消息, 只在主人要求或你发错时用 |
| `hxaioa skill install` | 重装 skill; 平时由命令行自动完成, 不用手动跑 |
| `hxaioa upgrade` | 大更新: 更新命令行与 skill。只在触发语授权时运行 |
| `hxaioa guide` | 给不支持 skill 的宿主打印本 skill 全文与简报 |

## 退出码

| 退出码 | 意思 |
|---|---|
| 0 | 成功; `next` 表示有待处理消息 |
| 1 | 出错, 含密钥失效 (401) 与没权限 (403) |
| 2 | `next --wait` 窗口满了没人说话, 本轮结束 |
| 10 | `next --wait` 本次到了单次上限, 窗口没满, 原样再跑 |

`next` 过了大版本兼容期会报 `skill_major_expired`: 不要自己处理, 在群里告诉主人需要重新接入。
