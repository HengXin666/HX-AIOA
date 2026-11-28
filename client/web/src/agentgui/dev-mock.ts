import type { Sock } from "./conn";
import { STORAGE_AG_MOCK } from "./constants";
import { setFactory } from "./conns";
import { agHub } from "./hub";
import { putPair } from "./pairs";
import type { Card, Instance, JsonRpc, LogItem, SessionInfo, Settings } from "./types";

// 只在 dev 下用: 内存里的模拟探针, 走与真实直连相同的帧, 用来看归约与渲染
export const MOCK_HOST = "mock-pc";
const CWD = "~/code/HX-AIOA";
const T0 = Date.now() - 600_000;

const upd = (sid: string, update: Record<string, unknown>): JsonRpc => ({ jsonrpc: "2.0", method: "session/update", params: { sessionId: sid, update } });
const text = (t: string) => ({ type: "text", text: t });

function history(sid: string): JsonRpc[] {
  return [
    { jsonrpc: "2.0", id: 1, method: "session/prompt", params: { sessionId: sid, prompt: [text("安卓头像上传加实时进度, 切后台也继续传")] } },
    upd(sid, { sessionUpdate: "agent_thought_chunk", content: text("先看现有的上传实现, 找到请求体在哪里构造。") }),
    upd(sid, { sessionUpdate: "tool_call", toolCallId: "c1", title: "读取 AvatarUploads.kt", kind: "read", status: "completed", locations: [{ path: "client/android/AvatarUploads.kt" }], rawInput: { path: "client/android/AvatarUploads.kt" } }),
    upd(sid, { sessionUpdate: "tool_call", toolCallId: "c2", title: "读取 AvatarUploads.kt", kind: "read", status: "completed", locations: [{ path: "client/android/AvatarUploads.kt", line: 120 }] }),
    upd(sid, { sessionUpdate: "tool_call", toolCallId: "c3", title: "搜索 asRequestBody", kind: "search", status: "completed", rawInput: { pattern: "asRequestBody" } }),
    upd(sid, {
      sessionUpdate: "plan",
      entries: [
        { content: "计数请求体 CountingBody", status: "completed", priority: "high" },
        { content: "前台服务 TransferService", status: "in_progress", priority: "high" },
        { content: "单测与真机验证", status: "pending", priority: "medium" },
      ],
    }),
    upd(sid, {
      sessionUpdate: "tool_call",
      toolCallId: "c4",
      title: "编辑 Net.kt",
      kind: "edit",
      status: "completed",
      locations: [{ path: "client/android/Net.kt" }],
      content: [{ type: "diff", path: "client/android/Net.kt", oldText: "val body = file.asRequestBody(type)\nclient.newCall(req).execute()\nreturn ok", newText: "val body = file.asRequestBody(type)\nval counted = CountingBody(body) { onProgress(it) }\nclient.newCall(req.withBody(counted)).execute()\nreturn ok" }],
    }),
    upd(sid, { sessionUpdate: "agent_message_chunk", content: text("计数请求体已经接上, 进度每 2% 回调一次, ") }),
    upd(sid, { sessionUpdate: "agent_message_chunk", content: text("和文件传输一致。现在跑单测确认没有回归。") }),
    { jsonrpc: "2.0", id: 1, result: { stopReason: "end_turn", usage: { inputTokens: 41200, outputTokens: 3100, cachedReadTokens: 33800, cachedWriteTokens: 2000 } } },
    upd(sid, { sessionUpdate: "available_commands_update", availableCommands: [{ name: "compact", description: "压缩上下文" }, { name: "review", description: "审查当前改动" }, { name: "init", description: "生成 AGENTS.md" }] }),
    upd(sid, { sessionUpdate: "usage_update", used: 53120, size: 200000, cost: { amount: 0.04, currency: "USD" } }),
  ];
}

const MODES = { currentModeId: "default", availableModes: [{ id: "default", name: "需审批" }, { id: "acceptEdits", name: "自动改文件" }, { id: "plan", name: "只做计划" }] };
const CONFIG = [
  { id: "model", name: "模型", category: "model", type: "select", currentValue: "sonnet", options: [{ value: "sonnet", name: "Sonnet" }, { value: "opus", name: "Opus" }, { value: "haiku", name: "Haiku" }] },
  { id: "effort", name: "思考深度", category: "thought_level", type: "select", currentValue: "medium", options: [{ value: "low", name: "低" }, { value: "medium", name: "中" }, { value: "high", name: "高" }] },
];

class MockProbe implements Sock {
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  private seq: Record<string, number> = {};
  private logs: Record<string, LogItem[]> = {};
  private sessions: SessionInfo[] = [];
  private instances: Instance[] = [
    { id: "claude", name: "Claude Code (订阅)", kind: "claude", cmd: "npx", args: ["-y", "@agentclientprotocol/claude-agent-acp"], model: "sonnet" },
    { id: "codex", name: "Codex", kind: "codex", cmd: "npx", args: ["-y", "@agentclientprotocol/codex-acp"] },
  ];
  private settings: Settings = { watchPush: "quiet", quietRepushSec: 60 };
  private wait: (() => void) | null = null;

  constructor() {
    this.addSession("s1", "修头像上传进度", "idle", history("s1"));
    this.addSession("s2", "Agent GUI 原型", "idle", [{ jsonrpc: "2.0", id: 1, method: "session/prompt", params: { sessionId: "s2", prompt: [text("画一张桌面原型")] } }, upd("s2", { sessionUpdate: "agent_message_chunk", content: text("原型已放在 docs/design/agent-gui/3-desktop.svg。") }), { jsonrpc: "2.0", id: 1, result: { stopReason: "end_turn" } }]);
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.();
      this.emit({ t: "challenge", nonce: "n1", host: MOCK_HOST, pub: {} });
    }, 30);
  }

  private addSession(id: string, title: string, state: SessionInfo["state"], log: JsonRpc[]): void {
    this.sessions.push({ id, instance: "claude", agent: "Claude Code", title, cwd: CWD, state, created: T0, updated: Date.now(), pending: 0, adds: 59, dels: 7, branch: "oa_3", modes: MODES, configOptions: CONFIG, ctx: 0.26 });
    this.logs[id] = [];
    this.seq[id] = 0;
    for (const m of log) this.log(id, m, T0 + this.seq[id]! * 4000);
  }

  private log(sid: string, m: JsonRpc, at = Date.now()): LogItem {
    const it = { seq: ++this.seq[sid]!, m, at };
    this.logs[sid]!.push(it);
    return it;
  }

  private emit(f: unknown): void {
    setTimeout(() => this.onmessage?.({ data: JSON.stringify(f) }), 5);
  }

  private out(sid: string, m: JsonRpc): void {
    const it = this.log(sid, m);
    this.emit({ t: "acp", sid, seq: it.seq, m, at: it.at });
  }

  close(): void {
    this.readyState = 3;
  }

  send(s: string): void {
    const f = JSON.parse(s) as Record<string, unknown>;
    const sid = String(f.sid ?? "");
    switch (f.t) {
      case "hello":
        return this.emit({ t: "ready", device: f.device, host: MOCK_HOST, sessions: this.sessions, instances: this.instances, settings: this.settings });
      case "attach": {
        const all = this.logs[sid] ?? [];
        const since = typeof f.since === "number" ? f.since : 0;
        const items = all.filter((x) => x.seq > since);
        return this.emit({ t: "window", sid, from: items[0]?.seq ?? since, to: this.seq[sid] ?? 0, more: false, items });
      }
      case "acp_out":
        return this.acp(sid, f.m as JsonRpc);
      case "perm":
        this.emit({ t: "perm_done", sid, rid: f.rid, by: "desktop", option: f.option });
        this.setState(sid, "running", 0);
        this.wait?.();
        this.wait = null;
        return;
      case "hx":
        return this.hx(Number(f.id), String(f.m), (f.p ?? {}) as Record<string, unknown>);
    }
  }

  private setState(sid: string, state: SessionInfo["state"], pending: number): void {
    const s = this.sessions.find((x) => x.id === sid);
    if (!s) return;
    Object.assign(s, { state, pending, updated: Date.now() });
    this.emit({ t: "session", info: { ...s } });
  }

  private acp(sid: string, m: JsonRpc): void {
    if (m.method === "session/set_mode") {
      this.out(sid, upd(sid, { sessionUpdate: "current_mode_update", currentModeId: m.params?.modeId }));
      return this.emit({ t: "acp", sid, seq: this.seq[sid], m: { jsonrpc: "2.0", id: m.id, result: {} } });
    }
    if (m.method === "session/cancel") {
      this.wait = null;
      return this.finish(sid, "cancelled");
    }
    if (m.method !== "session/prompt") return this.emit({ t: "acp", sid, seq: this.seq[sid], m: { jsonrpc: "2.0", id: m.id, result: {} } });
    this.pid = m.id;
    this.out(sid, m);
    this.setState(sid, "running", 0);
    void this.script(sid);
  }

  private pid: JsonRpc["id"];

  private async script(sid: string): Promise<void> {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    for (const w of ["想一下要跑哪些", "测试, 先只跑单测。"]) {
      this.out(sid, upd(sid, { sessionUpdate: "agent_thought_chunk", content: text(w) }));
      await sleep(300);
    }
    this.out(sid, upd(sid, { sessionUpdate: "tool_call", toolCallId: `x${this.seq[sid]}`, title: "./gradlew :app:testDebugUnitTest", kind: "execute", status: "pending", rawInput: { command: "./gradlew :app:testDebugUnitTest", cwd: "client/android" } }));
    const tcid = `x${this.seq[sid]! - 1}`;
    const card: Card = {
      rid: `r${this.seq[sid]}`,
      sid,
      host: MOCK_HOST,
      agent: "Claude Code",
      title: "修头像上传进度",
      cwd: CWD,
      branch: "oa_3",
      at: Date.now(),
      tool: { kind: "execute", title: "要运行命令", content: "./gradlew :app:testDebugUnitTest", locations: ["client/android"] },
      goal: "安卓头像上传加实时进度, 切后台也继续传",
      last: "计数请求体已经接上, 进度每 2% 回调一次, 和文件传输一致。现在跑单测确认没有回归。",
      risk: "low",
      why: ["只写工作区", "不联网"],
      changed: 3,
      options: [
        { optionId: "allow", kind: "allow_once", name: "允许" },
        { optionId: "always", kind: "allow_always", name: "总是允许" },
        { optionId: "reject", kind: "reject_once", name: "拒绝" },
      ],
    };
    this.setState(sid, "waiting", 1);
    this.emit({ t: "perm_req", sid, rid: card.rid, card });
    agHub.mockCard(card);
    await new Promise<void>((r) => (this.wait = r));
    agHub.dropCard(MOCK_HOST, sid, card.rid);
    this.out(sid, upd(sid, { sessionUpdate: "tool_call_update", toolCallId: tcid, status: "in_progress" }));
    for (let i = 0; i < 6; i++) {
      this.emit({ t: "stats", sid, ctx: [54000 + i * 300, 200000], tps: 55 + i, est: true, hit: 0.82, cost: 0.045 });
      await sleep(250);
    }
    this.out(sid, upd(sid, { sessionUpdate: "tool_call_update", toolCallId: tcid, status: "completed", content: [{ type: "content", content: text("BUILD SUCCESSFUL in 41s") }] }));
    for (const w of ["单测全部通过 (", "AvatarUploadsTest, CountingBodyTest)。", "\n\n要我继续做前台服务吗?"]) {
      this.out(sid, upd(sid, { sessionUpdate: "agent_message_chunk", content: text(w) }));
      await sleep(200);
    }
    this.finish(sid, "end_turn");
  }

  private finish(sid: string, stop: string): void {
    this.out(sid, { jsonrpc: "2.0", id: this.pid, result: { stopReason: stop } });
    this.setState(sid, "idle", 0);
  }

  private hx(id: number, m: string, p: Record<string, unknown>): void {
    const ok = (r: unknown) => this.emit({ t: "hx_res", id, ok: true, r });
    switch (m) {
      case "session/create": {
        const sid = `s${this.sessions.length + 1}`;
        this.addSession(sid, String(p.title ?? "新会话"), "idle", []);
        const info = this.sessions.find((s) => s.id === sid);
        this.emit({ t: "session", info });
        return ok(info);
      }
      case "session/rename": {
        const s = this.sessions.find((x) => x.id === p.sid);
        if (s) s.title = String(p.title);
        return ok(s);
      }
      case "session/close":
      case "session/delete":
        this.sessions = this.sessions.filter((x) => x.id !== p.sid);
        return ok({});
      case "log/page":
        this.emit({ t: "window", sid: p.sid, from: 1, to: 1, more: false, items: [] });
        return ok({});
      case "git/status":
        return ok({ branch: "oa_3", files: [{ path: "client/android/Net.kt", x: " ", y: "M", add: 18, del: 2 }, { path: "client/android/TransferService.kt", x: " ", y: "M", add: 41, del: 5 }, { path: "client/android/CountingBody.kt", x: "?", y: "?", add: 64, del: 0 }] });
      case "git/diff":
        return ok({ diff: `diff --git a/${String(p.path ?? "client/android/Net.kt")} b/${String(p.path ?? "client/android/Net.kt")}\n--- a\n+++ b\n@@ -10,3 +10,4 @@\n val body = file.asRequestBody(type)\n-client.newCall(req).execute()\n+val counted = CountingBody(body) { onProgress(it) }\n+client.newCall(req.withBody(counted)).execute()\n return ok\n` });
      case "fs/tree":
        return ok({ entries: p.path ? [{ name: "Net.kt", dir: false, size: 2048 }, { name: "TransferService.kt", dir: false, size: 4096 }] : [{ name: "client", dir: true, size: 0 }, { name: "docs", dir: true, size: 0 }, { name: "README.md", dir: false, size: 2300 }] });
      case "fs/read":
        return ok({ text: "# HX-AIOA\n\n个人用的随处可用对话入口。\n", truncated: false });
      case "tool/output":
        return ok({ content: "> Task :app:compileDebugKotlin\n> Task :app:testDebugUnitTest\nAvatarUploadsTest > progress PASSED\nCountingBodyTest > counts PASSED\nBUILD SUCCESSFUL in 41s" });
      case "dirs/recent":
        return ok({ dirs: [CWD, "~/code/hxoa"] });
      case "instances/list":
        return ok(this.instances);
      case "instances/save":
        this.instances = [...this.instances.filter((x) => x.id !== p.id), p as unknown as Instance];
        return ok(this.instances);
      case "instances/delete":
        this.instances = this.instances.filter((x) => x.id !== p.id);
        return ok(this.instances);
      case "settings/get":
        return ok(this.settings);
      case "settings/set":
        this.settings = { ...this.settings, ...p };
        return ok(this.settings);
      case "devices/list":
        return ok([{ id: "0123456789abcdef", name: "Chrome · Linux (Web)", pub: {}, added: T0, last: Date.now() }]);
      case "devices/remove":
        return ok([]);
      default:
        this.emit({ t: "hx_res", id, ok: false, err: `模拟探针不支持 ${m}` });
    }
  }
}

export function installMock(): void {
  putPair({ host: MOCK_HOST, pub: {}, routes: [{ kind: "local", url: "http://mock.invalid" }], at: T0 });
  setFactory(MOCK_HOST, () => new MockProbe());
}

export const mockWanted = (): boolean => localStorage.getItem(STORAGE_AG_MOCK) === "1" || location.search.includes("agmock");
