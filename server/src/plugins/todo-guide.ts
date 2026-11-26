import { MAX_PDATA_BATCH, MAX_PDATA_ROWS, PATH_PDATA_COLL, TODO_COLL, TODO_PLUGIN, todoRowId } from "@hx-aioa/protocol";

// 待办接口说明, 由服务端生成, 插件模板不用重复写; 数据在插件数据 pdata 里 (#101)
export function todoGuide(_base: string, channel: string, gh = false): string {
  const path = PATH_PDATA_COLL.replace("{plugin}", TODO_PLUGIN).replace("{coll}", TODO_COLL);
  const id = todoRowId(channel, "t-542");
  const body = `{"channel":"${channel}","title":"...","note":"...","state":"open","prio":2,"src":542,"created":1764000000000}`;
  const lines = [
    "### 待办",
    `- 存在插件数据 \`${TODO_PLUGIN}\` 的 \`${TODO_COLL}\` 集合, 一行一条: id 是 \`<群>:<待办 id>\` (例 \`${id}\`), body 是整行 (写入时要写全, 读到的字段原样带回): \`${body}\`。`,
    `- 读 (增量): \`hxaioa api GET '${path}?since=0'\`, 只看 body.channel 为 \`${channel}\` 的; 记下返回的 rev, 下次用 since=<rev> 只拿变化, \`more\` 为 true 时接着读; \`deleted\` 为 true 的是已删除。只想看一眼全部也可以 \`hxaioa todos --all\`。`,
    `- 建或改 (一次最多 ${MAX_PDATA_BATCH} 行, ver 是读到的版本, 新建为 0): \`hxaioa api POST ${path} '{"items":[{"id":"${id}","ver":0,"body":${body}}]}'\`; 结果里某行有 \`conflict\` 说明主人刚改过, 以 conflict 里的当前行为准重新合并再写。`,
    "- state: open 待进行 / hold 挂起 / doing 进行中 / done 已完成; prio: 1 急, 2 普通, 3 以后再说; src 是来源消息 seq; created 是建立时间 (毫秒), 改的时候保持原值。",
    "- 开始动手做某条时先把它改成 doing, 做完改 done, 卡住改 hold 并在 note 写原因, 主人在 App 里实时看到。doneAt (完成时间) 与 gh (GitHub 同步状态) 由服务端维护, 不用写。",
    "- 关联: repo (owner/name) + issue (号); parent 填父待办的 id (不带群前缀), App 里按树展示。",
    "- 分区 area: 生活, 开发, 工作, 学习 这类短词 (20 字内); 生活事务填 area 不填 repo。开发类不填 area 时 App 按 repo 归到 \"开发\"。",
    "- 截止 due (毫秒时间戳, 按主人的东八区换算); remind 提前几分钟提醒 (0 为到点, 要先有 due), 到点服务端发 \"待办提醒\" 系统消息并弹通知; alarm 为 true 时手机按闹钟响铃; star 为 true 是重点, 显示在总览。",
    "- 周期 every: `{\"unit\":\"month\",\"n\":1,\"tz\":480}` (unit 为 day/week/month/year, 要先有 due 作第一期); 改成 done 时服务端自动把 due 推到下一期并回到 open, runs 记完成了几期, prevDue 是推期前的截止; 主人说 \"刚才那期没做完\" 时把 due 改回 prevDue, runs 减 1, 去掉 prevDue 和 lastDone 即撤销。主人说 \"每月交一次电费\" 这类就建周期待办。",
    `- 只删自己建错的: 同一接口传 \`{"id":"...","ver":<读到的版本>,"deleted":true}\`; 每个插件最多 ${MAX_PDATA_ROWS} 行 (含已删除的)。`,
  ];
  if (gh) {
    lines.push(
      "",
      "### GitHub issue (经服务端代办, 你拿不到也不需要 GitHub 令牌)",
      "- 关联了 issue 的待办会自动同步: issue 关闭 = done, 有评论 = doing, 重新打开 = 回到 open。",
      `- 建 issue 并关联待办: \`hxaioa api POST /api/v1/gh/issues/<owner>/<repo> '{"title":"...","body":"...","parent":75,"todo":{"channel":"${channel}","id":"t-542"}}'\` (parent 可选, 挂到父 issue 下)。`,
      "- 看 issue: `hxaioa api GET /api/v1/gh/issues/<owner>/<repo>` (?state=all) 或 `.../<号>`; 评论: `POST .../<号>/comments '{\"body\":\"...\"}'`; 关闭: `PATCH .../<号> '{\"state\":\"closed\"}'`。",
      "- 403 说明仓库没放行或你没权限: 在群里告诉主人去 GitHub 授权插件里打开, 不要重试。",
    );
  }
  return lines.join("\n");
}
