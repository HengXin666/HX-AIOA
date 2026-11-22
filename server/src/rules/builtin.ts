import type { Rule } from "@hx-aioa/protocol";

// 开箱即用的默认规则, 永远排在用户规则与来源规则之后
export const BUILTIN_RULES: Rule[] = [
  {
    id: "builtin:resolved",
    name: "恢复通知只静默更新",
    enabled: true,
    builtin: true,
    when: { kinds: ["event"], statuses: ["resolved"] },
    action: "silent",
  },
  {
    id: "builtin:need-me",
    name: "需要我处理的强提醒",
    enabled: true,
    builtin: true,
    when: { priorities: ["need_me"] },
    action: "alert",
  },
  {
    id: "builtin:reading",
    name: "值得一看的只进摘要",
    enabled: true,
    builtin: true,
    when: { priorities: ["worth_reading"] },
    action: "digest",
  },
  {
    id: "builtin:default",
    name: "其余普通推送",
    enabled: true,
    builtin: true,
    when: {},
    action: "push",
  },
];
