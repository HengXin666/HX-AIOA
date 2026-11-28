// 归约自测: node --import tsx client/web/src/agentgui/reduce.check.ts (不进应用包)
import { lineDiff, mergeTools, parseUnified, Reducer, segments, type Item } from "./reduce";
import { SessionStore } from "./session";
import type { JsonRpc, LogItem } from "./types";

let n = 0;
function ok(cond: unknown, what: string): void {
  n++;
  if (!cond) throw new Error(`失败: ${what}`);
}

const upd = (update: Record<string, unknown>): JsonRpc => ({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "s", update } });
const text = (t: string) => ({ type: "text", text: t });
const log = (ms: JsonRpc[]): LogItem[] => ms.map((m, i) => ({ seq: i + 1, m, at: 1000 * (i + 1) }));

const items = log([
  { jsonrpc: "2.0", id: 7, method: "session/prompt", params: { sessionId: "s", prompt: [text("修 bug")] } },
  upd({ sessionUpdate: "agent_thought_chunk", content: text("先") }),
  upd({ sessionUpdate: "agent_thought_chunk", content: text("看看") }),
  upd({ sessionUpdate: "tool_call", toolCallId: "a", title: "读 x", kind: "read", status: "pending", locations: [{ path: "x.ts" }] }),
  upd({ sessionUpdate: "tool_call_update", toolCallId: "a", status: "completed" }),
  upd({ sessionUpdate: "tool_call", toolCallId: "b", title: "读 x", kind: "read", status: "completed", locations: [{ path: "x.ts" }] }),
  upd({ sessionUpdate: "tool_call", toolCallId: "c", kind: "edit", status: "completed", locations: [{ path: "x.ts" }], content: [{ type: "diff", path: "x.ts", oldText: "a\nb", newText: "a\nc\nd" }] }),
  upd({ sessionUpdate: "plan", entries: [{ content: "一", status: "completed" }, { content: "二", status: "pending" }] }),
  upd({ sessionUpdate: "plan", entries: [{ content: "一", status: "completed" }, { content: "二", status: "completed" }] }),
  upd({ sessionUpdate: "agent_message_chunk", content: text("好了") }),
  upd({ sessionUpdate: "agent_message_chunk", content: text(", 改完") }),
  upd({ sessionUpdate: "available_commands_update", availableCommands: [{ name: "compact", description: "压缩" }] }),
  upd({ sessionUpdate: "current_mode_update", currentModeId: "plan" }),
  upd({ sessionUpdate: "usage_update", used: 10, size: 100 }),
  { jsonrpc: "2.0", id: 7, result: { stopReason: "end_turn", usage: { inputTokens: 5, outputTokens: 2 } } },
  { jsonrpc: "2.0", id: 8, method: "session/prompt", params: { sessionId: "s", prompt: [text("再来")] } },
  { jsonrpc: "2.0", id: 8, error: { code: -32000, message: "usage limit", data: { kind: "usage_limit" } } },
]);

const r = new Reducer(items);
const v = r.view;
ok(v.turns.length === 2, "两轮");
const t0 = v.turns[0]!;
ok(t0.user?.[0]?.text === "修 bug", "用户消息");
ok(!t0.running && t0.stop === "end_turn" && t0.usage?.input === 5, "第一轮结束带 usage");
const kinds = t0.items.map((i: Item) => i.t).join(",");
ok(kinds === "thought,tool,tool,tool,plan,msg", `项顺序 ${kinds}`);
ok(t0.items[0]?.t === "thought" && t0.items[0].text === "先看看", "思考合并");
const tool = t0.items[1];
ok(tool?.t === "tool" && tool.tool.status === "completed" && tool.tool.title === "读 x", "tool_call_update 按 id 合并");
const plan = t0.items[4];
ok(plan?.t === "plan" && plan.entries[1]?.status === "completed", "计划原地更新");
ok(t0.items[5]?.t === "msg" && t0.items[5].text === "好了, 改完", "回答合并");
ok(v.commands[0]?.name === "compact" && v.modes?.currentModeId === "plan" && v.usage?.size === 100, "命令, 模式, 用量");
const t1 = v.turns[1]!;
ok(!t1.running && t1.items[0]?.t === "error", "出错结束一轮");
const segs = segments(t0.items);
ok(segs.length === 3 && segs[0]?.t === "group" && segs[0].items.length === 4, "工作组");
const tools = t0.items.flatMap((i) => (i.t === "tool" ? [i.tool] : []));
const rows = mergeTools(tools);
ok(rows.length === 2 && rows[0]?.tools.length === 2, "同文件连读合并");
const d = lineDiff("a\nb", "a\nc\nd");
ok(d.filter((l) => l.op === "+").length === 2 && d.filter((l) => l.op === "-").length === 1, "行 diff");
const u = parseUnified("diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n");
ok(u.length === 1 && u[0]?.add === 1 && u[0].del === 1, "统一 diff 解析");

// 重放: 增量 push 与一次性重建结果一致
const inc = new Reducer();
for (const it of items) inc.push(it);
ok(JSON.stringify(inc.view) === JSON.stringify(v), "增量与重建一致");

// session/load 回放用户消息
const load = new Reducer(log([upd({ sessionUpdate: "user_message_chunk", content: text("你") }), upd({ sessionUpdate: "user_message_chunk", content: text("好") }), upd({ sessionUpdate: "agent_message_chunk", content: text("嗨") })]));
ok(load.view.turns.length === 1 && load.view.turns[0]?.user?.[0]?.text === "你好", "user_message_chunk 合并");

// 本地占位的 prompt 被探针回显后去重; 乱序到达后重算
const st = new SessionStore("s");
st.window(1, log([items[0]!.m, items[14]!.m]), true);
const mine: JsonRpc = { jsonrpc: "2.0", id: 1, method: "session/prompt", params: { sessionId: "s", prompt: [text("新问题")] } };
st.localPrompt(mine);
ok(st.snapshot().view.turns.length === 2 && st.snapshot().view.turns[1]?.local, "本地占位");
st.acp(3, mine);
ok(st.snapshot().view.turns.length === 2 && !st.snapshot().view.turns[1]?.local, "回显去重");
st.acp(5, upd({ sessionUpdate: "agent_message_chunk", content: text("B") }));
st.acp(4, upd({ sessionUpdate: "agent_message_chunk", content: text("A") }));
const lastTurn = st.snapshot().view.turns[1]!;
ok(lastTurn.items[0]?.t === "msg" && lastTurn.items[0].text === "AB", "乱序重算");
ok(st.since() === 5 && st.snapshot().more, "补帧起点与更多");

console.log(`归约自测通过 ${n} 项`);
