import { MAX_TODO_BATCH, MAX_TODOS } from "@hx-aioa/protocol";

// 待办接口说明, 由服务端生成, 插件模板不用重复写
export function todoGuide(_base: string, channel: string, gh = false): string {
  const path = `/api/v1/chats/${channel}/todos`;
  const lines = [
    "### 待办",
    `- 读全部: \`hxaioa api GET ${path}\` (每条带 created 创建时间, 关联了 issue 的还有 gh: GitHub 上的状态和评论数)。`,
    `- 建或改 (按 id 合并, 只传要改的字段, 一次最多 ${MAX_TODO_BATCH} 条): \`hxaioa api POST ${path} '{"todos":[{"id":"t-542","title":"...","note":"...","prio":2,"src":542}]}'\``,
    "- state: open 待进行 / hold 挂起 / doing 进行中 / done 已完成; prio: 1 急, 2 普通, 3 以后再说; src 是来源消息 seq。",
    "- 开始动手做某条时先把它改成 doing, 做完改 done, 卡住改 hold 并在 note 写原因, 主人在 App 里实时看到。",
    "- 关联: repo (owner/name) + issue (号); parent 填父待办的 id, App 里按树展示。",
    `- 只删自己建错的: \`hxaioa api DELETE ${path}/<id>\`; 每群最多 ${MAX_TODOS} 条。`,
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
