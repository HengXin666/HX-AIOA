// 假的 ACP Agent (stdio JSON-RPC), 给 tools/e2e-agent-gui.mjs 用
// prompt 时依次发: 思考, 消息, 计划, tool_call(execute) + request_permission, tool_call_update, usage_update, 最后回 stopReason + usage
// 环境变量 MOCK_ACP_TERMINAL=1 时额外通过 terminal/create 跑一次命令; prompt 文本含 "写文件" 时调用 fs/write_text_file
import readline from "node:readline";

const SID = "mock-session-1";
let n = 0;
const waiting = new Map();
const out = (m) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...m })}\n`);
const update = (u) => out({ method: "session/update", params: { sessionId: SID, update: u } });
const call = (method, params) =>
  new Promise((resolve) => {
    const id = `a${++n}`;
    waiting.set(id, resolve);
    out({ id, method, params });
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let cancelled = false;
// MOCK_ACP_AUTH=1: session/new 先报需要登录 (-32000), authenticate {methodId:"mock-login"} 之后才放行
const AUTH = process.env.MOCK_ACP_AUTH === "1";
let authed = !AUTH;
const authMethods = AUTH ? [{ id: "mock-login", name: "假登录", description: "测试用" }] : [];

const modes = { currentModeId: "default", availableModes: [{ id: "default", name: "默认" }, { id: "plan", name: "计划" }] };
const configOptions = [{ id: "model", name: "模型", category: "model", type: "select", currentValue: "mock-1", options: [{ value: "mock-1", name: "Mock 1" }, { value: "mock-2", name: "Mock 2" }] }];

async function prompt(id, p) {
  cancelled = false;
  const text = p.prompt?.map((b) => b.text ?? "").join("") ?? "";
  update({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "先想一想要做什么。" } });
  for (const w of ["好的, ", "我来跑一下 ", "测试。"]) {
    await sleep(30);
    update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: w } });
  }
  update({ sessionUpdate: "plan", entries: [{ content: "跑测试", priority: "high", status: "in_progress" }, { content: "汇报", priority: "low", status: "pending" }] });
  if (text.includes("写文件")) {
    await call("fs/write_text_file", { sessionId: SID, path: "mock-out.txt", content: "hello" });
    const r = await call("fs/read_text_file", { sessionId: SID, path: "mock-out.txt" });
    update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: `读回: ${r.content}` } });
  }
  const tc = { toolCallId: "tc1", title: "运行 rm -rf build", kind: "execute", status: "pending", rawInput: { command: "rm -rf build && npm test" } };
  update({ sessionUpdate: "tool_call", ...tc });
  const res = await call("session/request_permission", {
    sessionId: SID,
    toolCall: { toolCallId: "tc1" },
    options: [
      { optionId: "allow", name: "允许一次", kind: "allow_once" },
      { optionId: "always", name: "总是允许", kind: "allow_always" },
      { optionId: "reject", name: "拒绝", kind: "reject_once" },
    ],
  });
  const ok = res?.outcome?.outcome === "selected" && res.outcome.optionId !== "reject";
  let output = ok ? "测试通过 ".repeat(400) : "已拒绝";
  if (ok && process.env.MOCK_ACP_TERMINAL === "1") {
    const t = await call("terminal/create", { sessionId: SID, command: "echo", args: ["来自终端"] });
    await call("terminal/wait_for_exit", { sessionId: SID, terminalId: t.terminalId });
    const o = await call("terminal/output", { sessionId: SID, terminalId: t.terminalId });
    output += o.output;
    update({ sessionUpdate: "tool_call_update", toolCallId: "tc1", content: [{ type: "terminal", terminalId: t.terminalId }] });
  }
  update({ sessionUpdate: "tool_call_update", toolCallId: "tc1", status: ok ? "completed" : "failed", content: [{ type: "content", content: { type: "text", text: output } }] });
  update({ sessionUpdate: "usage_update", used: 53000, size: 200000, cost: { amount: 0.045, currency: "USD" } });
  for (let i = 0; i < 5; i++) {
    await sleep(20);
    update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "继续输出一些文字用来估算速度。" } });
  }
  out({ id, result: { stopReason: cancelled || !ok ? (cancelled ? "cancelled" : "end_turn") : "end_turn", usage: { totalTokens: 1500, inputTokens: 200, outputTokens: 120, cachedReadTokens: 1000, cachedWriteTokens: 180 } } });
}

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  if (m.method === undefined) {
    waiting.get(m.id)?.(m.result);
    waiting.delete(m.id);
    return;
  }
  switch (m.method) {
    case "initialize":
      return out({ id: m.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true, promptCapabilities: { image: false } }, agentInfo: { name: "mock", version: "1", _meta: { token: process.env.AIOA_TOKEN ?? null } }, authMethods } });
    case "authenticate":
      if (m.params?.methodId !== "mock-login") return out({ id: m.id, error: { code: -32602, message: "未知登录方式" } });
      authed = true;
      return out({ id: m.id, result: {} });
    case "session/new":
      if (!authed) return out({ id: m.id, error: { code: -32000, message: "Authentication required" } });
      return out({ id: m.id, result: { sessionId: SID, modes, configOptions } });
    case "session/load":
      update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "回放的旧消息" } });
      return out({ id: m.id, result: { modes, configOptions } });
    case "session/set_mode":
      modes.currentModeId = m.params.modeId;
      update({ sessionUpdate: "current_mode_update", currentModeId: m.params.modeId });
      return out({ id: m.id, result: {} });
    case "session/set_config_option":
      configOptions[0].currentValue = m.params.value;
      return out({ id: m.id, result: { configOptions } });
    case "session/prompt":
      return prompt(m.id, m.params);
    case "session/cancel":
      cancelled = true;
      return;
    default:
      if (m.id !== undefined) out({ id: m.id, error: { code: -32601, message: `未实现: ${m.method}` } });
  }
});
