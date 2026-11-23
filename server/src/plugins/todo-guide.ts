import { MAX_TODO_BATCH, MAX_TODOS } from "@hx-aioa/protocol";

// 待办接口说明, 由服务端生成, 插件模板不用重复写
export function todoGuide(base: string, channel: string): string {
  const path = `${base}/api/v1/chats/${channel}/todos`;
  return [
    "### 待办接口",
    `- 读全部: GET ${path} → \`{ "todos": [ { "id", "title", "note", "state", "prio", "src", "created", "updated" } ] }\``,
    `- 新增或修改 (按 id 合并, 只传要改的字段): POST ${path}, body \`{ "todos": [ { "id": "t-20261124-1", "title": "...", "note": "...", "prio": 2, "src": 123 } ] }\`, 一次最多 ${MAX_TODO_BATCH} 条, 每群最多 ${MAX_TODOS} 条`,
    "- id 由你生成, 稳定且唯一 (比如 `t-日期-序号`); 新增时必须有 title。",
    "- state: `open` 待办, `doing` 进行中, `done` 完成, `dropped` 放弃; prio: 1 急, 2 普通, 3 以后再说。",
    "- src 写来源消息的 seq, App 里点待办能跳回原消息。",
    `- 删除: DELETE ${path}/<id>。只删你自己建错的, 主人建的或勾掉的不要删。`,
    `- 引用回复某条消息: 发消息时加 \`"reply": <seq>\`。`,
  ].join("\n");
}
