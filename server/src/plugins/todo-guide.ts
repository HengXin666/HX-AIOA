import { MAX_PDATA_BATCH, MAX_PDATA_ROWS, PATH_PDATA_COLL, TODO_COLL, TODO_PLUGIN, todoRowId } from "@hx-aioa/protocol";

// 待办接口说明, 由服务端生成, 插件模板不用重复写; 数据在插件数据 pdata 里 (#101)
export function todoGuide(_base: string, channel: string): string {
  const path = PATH_PDATA_COLL.replace("{plugin}", TODO_PLUGIN).replace("{coll}", TODO_COLL);
  const id = todoRowId(channel, "t-542");
  const body = `{"channel":"${channel}","title":"...","note":"...","state":"open","prio":2,"src":542,"created":1764000000000}`;
  return [
    "### 待办",
    `- 存在插件数据 \`${TODO_PLUGIN}\` 的 \`${TODO_COLL}\` 集合, 一行一条: id 是 \`<群>:<待办 id>\` (例 \`${id}\`), body 是整行 (写入时要写全): \`${body}\`。`,
    `- 读 (增量): \`hxaioa api GET '${path}?since=0'\`, 只看 body.channel 为 \`${channel}\` 的; 记下返回的 rev, 下次用 since=<rev> 只拿变化, \`more\` 为 true 时接着读; \`deleted\` 为 true 的是已删除。`,
    `- 建或改 (一次最多 ${MAX_PDATA_BATCH} 行, ver 是读到的版本, 新建为 0): \`hxaioa api POST ${path} '{"items":[{"id":"${id}","ver":0,"body":${body}}]}'\`; 结果里某行有 \`conflict\` 说明主人刚改过, 以 conflict 里的当前行为准重新合并再写。`,
    "- state: open / doing / done / dropped; prio: 1 急, 2 普通, 3 以后再说; src 是来源消息 seq; created 是建立时间 (毫秒), 改的时候保持原值。",
    `- 只删自己建错的: 同一接口传 \`{"id":"...","ver":<读到的版本>,"deleted":true}\`; 每个插件最多 ${MAX_PDATA_ROWS} 行 (含已删除的)。`,
  ].join("\n");
}
