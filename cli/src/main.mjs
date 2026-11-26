#!/usr/bin/env node
// hxaioa: HX-AIOA 群 Agent 命令行。配置一次 (login), 之后直接收发消息, 长连监听
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { configPath, loadConfig, loadState, saveConfig, saveHead } from "./config.mjs";
import { print } from "./format.mjs";
import { ApiError, VERSION, call, enc } from "./http.mjs";
import { syncHistory } from "./history.mjs";
import { watch } from "./watch.mjs";

const HELP = `hxaioa ${VERSION}  HX-AIOA 群 Agent 命令行

  hxaioa login <服务地址> <密钥>   保存配置 (${configPath}, 权限 600) 并验证
  hxaioa me                        我是谁: 名字, 本群, 可读的群
  hxaioa guide [--ack]             打印专属指令; --ack 顺带报到
  hxaioa send <文字|->  [-c 群] [--reply seq] [--title 标题] [--html 文件] [--priority need_me|worth_reading]
  hxaioa read  [-c 群] [--new] [--since seq] [--before seq] [--limit n] [--json]
  hxaioa watch [-c 群] [--all] [--once] [--timeout 秒] [--window 秒] [--any] [--exec 命令] [--json] [--mine] [--interval 秒]
  hxaioa memory [--add 一句话] [--set 全文|-]   长期记忆 (存服务端, 最多 4000 字)
  hxaioa todos [-c 群] [--all] [--json]          本群待办; --all 含已完成
  hxaioa history [-c 群] [--limit 条数]          历史存本地文件 (增量), 打印路径, 用 grep / sed 节选
  hxaioa typing [-c 群]            告诉群里 "正在输入"
  hxaioa recall <seq> | delete <seq>
  hxaioa report --title 标题 [--summary 摘要] [--file 正文.md] [--dedupe key]
  hxaioa api <METHOD> <路径> [JSON|-]

  不写 -c 就是本群。文字写 - 表示从标准输入读。环境变量 AIOA_SERVER / AIOA_KEY 可代替 login。
  watch 默认只等人发的消息, --any 时别的 Agent 和系统消息也算。
  watch --once 退出码: 0 来了一条; 2 等满了没人说话; 3 专属指令更新了 (先 guide --ack);
    4 本次 --timeout 到了但 --window 还没满, 再跑一次接着等 (命令有时长上限时用)。
  watch 优先用长连接 (省额度), 连不上自动改为每 --interval 秒 (默认 20) 拉一次。`;

const OPTIONS = {
  channel: { type: "string", short: "c" },
  reply: { type: "string" },
  title: { type: "string" },
  html: { type: "string" },
  priority: { type: "string" },
  new: { type: "boolean" },
  since: { type: "string" },
  before: { type: "string" },
  limit: { type: "string" },
  json: { type: "boolean" },
  all: { type: "boolean" },
  once: { type: "boolean" },
  timeout: { type: "string" },
  exec: { type: "string" },
  mine: { type: "boolean" },
  interval: { type: "string" },
  window: { type: "string" },
  any: { type: "boolean" },
  add: { type: "string" },
  set: { type: "string" },
  ack: { type: "boolean" },
  summary: { type: "string" },
  file: { type: "string" },
  dedupe: { type: "string" },
  help: { type: "boolean", short: "h" },
};

const num = (v) => (v === undefined ? undefined : Number.parseInt(v, 10));
const stdin = () => readFileSync(0, "utf8");
const out = (v) => process.stdout.write(`${typeof v === "string" ? v : JSON.stringify(v, null, 2)}\n`);

async function whoami(cfg) {
  const r = await call(cfg, "GET", "/api/v1/chat-agent/me");
  saveConfig({ me: r.me });
  return r.me;
}

async function channelOf(cfg, v) {
  if (v.channel) return v.channel;
  if (cfg.channel) return cfg.channel;
  return (cfg.me ?? (await whoami(cfg))).channel;
}

const EVERY_LABEL = { day: "天", week: "周", month: "个月", year: "年" };
const STATE_LABEL = { open: "待进行", hold: "挂起", doing: "进行中", done: "已完成", dropped: "已完成" };
// 一行一条: [状态] P优先级 id 标题 (repo#issue) <- 父 | note
function todoLine(t) {
  const issue = t.repo && t.issue ? ` (${t.repo}#${t.issue})` : "";
  const parent = t.parent ? ` <- ${t.parent}` : "";
  const note = t.note ? ` | ${t.note.replace(/\s+/g, " ").slice(0, 80)}` : "";
  // 分区, 截止 (东八区), 周期, 星标 (#105)
  const due = t.due ? ` 截止 ${new Date(t.due + 8 * 3_600_000).toISOString().slice(5, 16).replace("T", " ")}` : "";
  const plan = `${t.star ? " ★" : ""}${t.area ? ` {${t.area}}` : ""}${due}${t.every ? ` 每${t.every.n}${EVERY_LABEL[t.every.unit] ?? t.every.unit}` : ""}`;
  return `[${STATE_LABEL[t.state] ?? t.state}] P${t.prio ?? 2} ${t.id} ${t.title}${plan}${issue}${parent}${note}`;
}

const COMMANDS = {
  async login(cfg, v, [server, key]) {
    if (!server || !key) throw new ApiError(0, "用法: hxaioa login <服务地址> <密钥>");
    const next = { ...cfg, server: server.replace(/\/+$/, ""), key };
    const me = (await call(next, "GET", "/api/v1/chat-agent/me")).me;
    saveConfig({ server: next.server, key, me });
    out(`已登录: ${me.name} (本群 ${me.channel ?? "无"})`);
  },
  me: async (cfg) => out(await whoami(cfg)),
  async guide(cfg, v) {
    const res = await call(cfg, "GET", "/api/v1/chat-agent/guide", undefined, { raw: true });
    const version = res.headers.get("X-Aioa-Guide-Version");
    out(await res.text());
    if (!v.ack) return;
    const ok = (await call(cfg, "POST", "/api/v1/chat-agent/ack", { version })).ok;
    if (ok) saveConfig({ guide: version });
    out(ok ? `已报到 ${version}` : "报到失败");
  },
  async send(cfg, v, [text]) {
    const body = { text: text === "-" || text === undefined ? stdin() : text };
    if (v.channel) body.channel = v.channel;
    if (v.reply) body.reply = num(v.reply);
    if (v.title) body.title = v.title;
    if (v.priority) body.priority = v.priority;
    if (v.html) body.html = readFileSync(v.html, "utf8");
    out(await call(cfg, "POST", "/api/v1/messages", body));
  },
  async read(cfg, v) {
    const ch = await channelOf(cfg, v);
    const limit = num(v.limit) ?? 50;
    const q = v.before ? `before=${num(v.before)}` : `since=${v.new ? (loadState().heads[ch] ?? 0) : (num(v.since) ?? 0)}`;
    const r = await call(cfg, "GET", `/api/v1/chats/${enc(ch)}/messages?${q}&limit=${limit}`);
    for (const ev of r.messages ?? []) print(ev, v.json);
    if (v.new && r.head) saveHead(ch, r.head);
  },
  async watch(cfg, v) {
    // 每次重新问身份: 轮换密钥或改名后, 旧的 sourceId 会把自己的消息当成别人的
    const me = await whoami(cfg).catch(() => cfg.me);
    const channels = v.all ? null : [await channelOf(cfg, v)];
    const opts = { channels, once: v.once, timeout: num(v.timeout), window: num(v.window), json: v.json, exec: v.exec, mine: v.mine, any: v.any, interval: num(v.interval) };
    return watch(cfg, me, { ...opts, guide: cfg.guide });
  },
  async memory(cfg, v) {
    const path = "/api/v1/chat-agent/memory";
    if (v.set !== undefined) return out(await call(cfg, "PUT", path, { text: v.set === "-" ? stdin() : v.set }));
    const cur = await call(cfg, "GET", path);
    if (v.add === undefined) return out(cur.text || "(还没有记忆)");
    const stamp = new Date().toISOString().slice(0, 10);
    const r = await call(cfg, "PUT", path, { text: [cur.text, `- ${stamp} ${v.add.trim()}`].filter(Boolean).join("\n") });
    out(`已记, 共 ${r.text.length} 字`);
  },
  async history(cfg, v) {
    const ch = await channelOf(cfg, v);
    const h = await syncHistory(cfg, ch, num(v.limit));
    if (v.json) return out(h);
    out(`${h.file}\n共 ${h.count} 条 (#${h.first} 到 #${h.last}), 本次拉了 ${h.fetched} 条。一行一条, 首行 "#seq 时间 名字: 正文", 多行正文缩进两格。`);
    out(`节选: grep -n "关键词" ${h.file} | tail -20; sed -n '100,160p' ${h.file}; 原始 JSON 在 ${h.json}`);
  },
  async todos(cfg, v) {
    const r = await call(cfg, "GET", `/api/v1/chats/${enc(await channelOf(cfg, v))}/todos`);
    const list = (r.todos ?? []).filter((t) => v.all || (t.state !== "done" && t.state !== "dropped"));
    if (v.json) return out(list);
    if (!list.length) return out("(没有待办)");
    for (const t of list) out(todoLine(t));
  },
  async typing(cfg, v) {
    out(await call(cfg, "POST", `/api/v1/chats/${enc(await channelOf(cfg, v))}/typing`, {}));
  },
  recall: (cfg, v, [seq]) => call(cfg, "DELETE", `/api/v1/events/seq/${num(seq)}?mode=recall`).then(out),
  delete: (cfg, v, [seq]) => call(cfg, "DELETE", `/api/v1/events/seq/${num(seq)}?mode=delete`).then(out),
  async report(cfg, v) {
    if (!v.title) throw new ApiError(0, "report 需要 --title");
    const data = { title: v.title, ...(v.summary ? { summary: v.summary } : {}), ...(v.file ? { markdown: readFileSync(v.file, "utf8") } : {}) };
    out(await call(cfg, "POST", "/api/v1/events", { kind: "report", data, ...(v.dedupe ? { dedupeKey: v.dedupe } : {}), ...(v.channel ? { channel: v.channel } : {}) }));
  },
  async api(cfg, v, [method, path, body]) {
    if (!method || !path) throw new ApiError(0, "用法: hxaioa api <METHOD> <路径> [JSON|-]");
    out(await call(cfg, method.toUpperCase(), path, body === "-" ? stdin() : body));
  },
  version: async () => out(VERSION),
};

async function main() {
  const { values, positionals } = parseArgs({ options: OPTIONS, allowPositionals: true, strict: true });
  const [cmd, ...rest] = positionals;
  if (!cmd || values.help || !COMMANDS[cmd]) return out(HELP);
  const code = await COMMANDS[cmd](loadConfig(), values, rest);
  if (typeof code === "number") process.exitCode = code;
}

main().catch((e) => {
  process.stderr.write(`${e instanceof ApiError || e.code === "ERR_PARSE_ARGS_UNKNOWN_OPTION" ? e.message : e.stack}\n`);
  process.exitCode = 1;
});
