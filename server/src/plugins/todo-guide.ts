import { MAX_TODO_BATCH, MAX_TODOS } from "@hx-aioa/protocol";

// 待办接口说明, 由服务端生成, 插件模板不用重复写
export function todoGuide(_base: string, channel: string): string {
  const path = `/api/v1/chats/${channel}/todos`;
  return [
    "### 待办",
    `- 读: \`hxaioa api GET ${path}\``,
    `- 建或改 (按 id 合并, 只传要改的字段, 一次最多 ${MAX_TODO_BATCH} 条): \`hxaioa api POST ${path} '{"todos":[{"id":"t-542","title":"...","note":"...","prio":2,"src":542}]}'\``,
    "- state: open / doing / done / dropped; prio: 1 急, 2 普通, 3 以后再说; src 是来源消息 seq。",
    `- 只删自己建错的: \`hxaioa api DELETE ${path}/<id>\`; 每群最多 ${MAX_TODOS} 条。`,
  ].join("\n");
}
