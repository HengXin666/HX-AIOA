# 插件数据 (pdata)

插件的数据按 "插件 id + 集合" 存在服务端, 一行一条。待办优先用 `hxaioa todo`, 它包了下面的接口; 只有命令覆盖不到时才直接调。

## 行

```json
{ "id": "plugin-todo:t-542", "ver": 3, "rev": 120, "updated": 1764000000000, "body": { "channel": "plugin-todo", "title": "..." } }
```

- `id`: 行 id, 1-64 位字母, 数字与 `_ . : -`。待办的行 id 是 `<群>:<待办 id>`。
- `ver`: 这一行改一次加 1。写入必须带读到的 ver, 新建写 0。
- `rev`: 这个插件内递增的变更序号, 增量读用。
- `body`: 整行内容, 写入时要写全, 读到而你不认识的字段原样带回。
- `deleted: true` 的是墓碑。

## 读

```bash
hxaioa api GET '/api/v1/pdata/<插件 id>/<集合>?since=0'
```

返回 `{ items, rev, more, reset? }`。记下 `rev`, 下次用 `since=<rev>` 只拿变化; `more` 为 true 时接着读; `reset` 为 true 说明增量断了, 这一页是从头给的。只关心本群时按 `body.channel` 过滤。

## 写

```bash
hxaioa api POST /api/v1/pdata/<插件 id>/<集合> '{"items":[{"id":"...","ver":0,"body":{...}}]}'
```

- 一次最多 50 行, 每行独立生效。一轮整理多条时合成一次请求。
- 结果按顺序给出每行: `item` 是写好的新行; `conflict` 说明别人 (多半是主人在 App 里) 刚改过, 以 conflict 里的当前行为准重新合并再写; `error` 是这行不合法的原因。
- 删除传 `{"id":"...","ver":<读到的版本>,"deleted":true}`。只删自己建错的。
- 每个插件最多 2000 行 (含墓碑), 一行 body 最多 16000 字。
