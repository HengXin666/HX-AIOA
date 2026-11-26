#!/usr/bin/env node
// hxaioa: HX-AIOA 群 Agent 命令行。配置一次 (login), 之后直接收发消息, 长连监听; 装了 skill 的 Agent 一轮用 next / send --covers / done
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { configPath, loadConfig, loadState, saveConfig, saveHead } from "./config.mjs";
import { print } from "./format.mjs";
import { ApiError, VERSION, call, enc } from "./http.mjs";
import { syncHistory } from "./history.mjs";
import { next } from "./next.mjs";
import { PATH_AGENT_DONE, PATH_AGENT_ME, PATH_AGENT_TRIGGER, PATH_MESSAGES } from "./proto.mjs";
import { install, installedText, settleWant, skillGuide, upgrade } from "./skill.mjs";
import { todoAdd, todoLine, todoSet } from "./todo.mjs";
import { watch } from "./watch.mjs";

const HELP = `hxaioa ${VERSION}  HX-AIOA 群 Agent 命令行

一轮 (装了 hx-aioa skill 的 Agent)
  hxaioa next [--wait 秒] [--timeout 秒]   待处理消息; 没有就等人说话。退出码 0 有消息, 10 原样再跑, 2 idle 本轮结束
  hxaioa send <文字|-> --reply seq --covers 849,850   回复并把这些 seq 记为已处理
  hxaioa done <seq...>             不用回复的记为已处理
  hxaioa todo add <标题> [--prio n] [--repo r] [--issue n] [--parent id] [--note s] [--src seq] [--id id]
  hxaioa todo set <id> [--title t] [--state open|hold|doing|done] [--prio n] [--repo r] [--issue n] [--parent id] [--note s]
  hxaioa todo done <id> [--note s]     冲突时打印当前行, 退出码 3
  hxaioa skill install [--setup N] [--dir 目录]   从 Git 装 skill (接入语里用)
  hxaioa me --trigger <定时表达式>     上报定时任务的触发方式
  hxaioa upgrade                   大更新自动执行 (只在主人开了开关时有效)

其它
  hxaioa login <服务地址> <密钥>   保存配置 (${configPath}, 权限 600) 并验证
  hxaioa me                        我是谁: 名字, 本群, 可读的群
  hxaioa guide [--ack]             装了 skill: 打印 SKILL.md 与简报; 没装: 打印专属指令, --ack 顺带报到
  hxaioa send <文字|->  [-c 群] [--reply seq] [--title 标题] [--html 文件] [--priority need_me|worth_reading] [--covers seq,...]
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
  watch 默认只等人发的消息, --any 时别的 Agent 和系统消息也算; 消息打印 (或 --exec) 之后才记为读到。
  watch --once 退出码: 0 来了一条; 2 等满了没人说话; 3 专属指令更新了 (先 guide --ack);
    4 本次 --timeout 到了但 --window 还没满, 再跑一次接着等 (命令有时长上限时用)。
  小更新 hxaioa 自己装好, 下一轮生效; 看到 "大更新, 需要重新接入" 就停下在群里告诉主人。`;

const STR = { type: "string" };
const BOOL = { type: "boolean" };
const OPTIONS = {
  channel: { ...STR, short: "c" },
  ...Object.fromEntries(["reply", "title", "html", "priority", "since", "before", "limit", "timeout", "exec", "interval", "window", "add", "set", "summary", "file", "dedupe"].map((k) => [k, STR])),
  ...Object.fromEntries(["wait", "setup", "dir", "covers", "trigger", "prio", "repo", "issue", "parent", "note", "src", "state", "id"].map((k) => [k, STR])),
  ...Object.fromEntries(["new", "json", "all", "once", "mine", "any", "ack"].map((k) => [k, BOOL])),
  help: { ...BOOL, short: "h" },
};

const num = (v) => (v === undefined ? undefined : Number.parseInt(v, 10));
const stdin = () => readFileSync(0, "utf8");
const out = (v) => process.stdout.write(`${typeof v === "string" ? v : JSON.stringify(v, null, 2)}\n`);

function seqs(list) {
  const all = list.flatMap((s) => String(s).split(/[,\s]+/)).filter(Boolean).map((s) => Number.parseInt(s.replace(/^#/, ""), 10));
  if (!all.length || all.some((n) => !Number.isInteger(n) || n <= 0)) throw new ApiError(0, "seq 要是正整数, 如 849 850 或 849,850");
  return [...new Set(all)];
}

async function whoami(cfg) {
  const r = await call(cfg, "GET", PATH_AGENT_ME);
  saveConfig({ me: r.me });
  return r.me;
}

async function channelOf(cfg, v) {
  if (v.channel) return v.channel;
  if (cfg.channel) return cfg.channel;
  return (cfg.me ?? (await whoami(cfg))).channel;
}

// 这些命令自己处理版本 (或不发请求), 结束时不再看 X-Aioa-Want
const SELF_SETTLED = new Set(["next", "skill", "upgrade", "login", "version"]);

const COMMANDS = {
  async login(cfg, v, [server, key]) {
    if (!server || !key) throw new ApiError(0, "用法: hxaioa login <服务地址> <密钥>");
    const next = { ...cfg, server: server.replace(/\/+$/, ""), key };
    const me = (await call(next, "GET", PATH_AGENT_ME)).me;
    saveConfig({ server: next.server, key, me });
    out(`已登录: ${me.name} (本群 ${me.channel ?? "无"})`);
  },
  async me(cfg, v) {
    if (v.trigger === undefined) return out(await whoami(cfg));
    const r = await call(cfg, "POST", PATH_AGENT_TRIGGER, { expr: v.trigger });
    const t = r.trigger ?? r;
    out(`已记下触发方式: ${t.expr ?? v.trigger}${t.every ? ` (约每 ${t.every} 秒)` : ""}`);
  },
  async guide(cfg, v) {
    if (cfg.skill?.dir && !v.ack) return out((await skillGuide(cfg)).join("\n"));
    const res = await call(cfg, "GET", "/api/v1/chat-agent/guide", undefined, { raw: true });
    const version = res.headers.get("X-Aioa-Guide-Version");
    out(await res.text());
    if (!v.ack) return;
    const ok = (await call(cfg, "POST", "/api/v1/chat-agent/ack", { version })).ok;
    if (ok) saveConfig({ guide: version });
    out(ok ? `已报到 ${version}` : "报到失败");
  },
  async skill(cfg, v, [sub]) {
    if (sub !== "install") throw new ApiError(0, "用法: hxaioa skill install [--setup N] [--dir 目录]");
    out(installedText(await install(cfg, { setup: v.setup, dir: v.dir })));
  },
  next: (cfg, v) => next(cfg, v),
  async done(cfg, v, list) {
    const r = await call(cfg, "POST", PATH_AGENT_DONE, { seqs: seqs(list) });
    out(`已记为处理完, 游标 #${r.cursor}, 还剩 ${r.left} 条没处理`);
  },
  async upgrade(cfg, v) {
    out((await upgrade(cfg, v)).join("\n"));
  },
  async todo(cfg, v, [sub, arg]) {
    const ch = await channelOf(cfg, v);
    if (sub === "add") return todoAdd(cfg, ch, v, arg, out);
    if (sub === "set") return todoSet(cfg, ch, v, arg, out);
    if (sub === "done") return todoSet(cfg, ch, { ...v, state: undefined }, arg, out, { state: "done" });
    throw new ApiError(0, "用法: hxaioa todo add|set|done ...");
  },
  async send(cfg, v, [text]) {
    const body = { text: text === "-" || text === undefined ? stdin() : text };
    if (v.channel) body.channel = v.channel;
    if (v.reply) body.reply = num(v.reply);
    if (v.title) body.title = v.title;
    if (v.priority) body.priority = v.priority;
    if (v.html) body.html = readFileSync(v.html, "utf8");
    if (v.covers) body.covers = seqs([v.covers]);
    out(await call(cfg, "POST", PATH_MESSAGES, body));
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
  const cfg = loadConfig();
  const code = await COMMANDS[cmd](cfg, values, rest);
  if (!SELF_SETTLED.has(cmd)) for (const l of await settleWant(cfg)) out(l);
  if (typeof code === "number") process.exitCode = code;
}

main().catch((e) => {
  process.stderr.write(`${e instanceof ApiError || e.code === "ERR_PARSE_ARGS_UNKNOWN_OPTION" ? e.message : e.stack}\n`);
  process.exitCode = 1;
});
