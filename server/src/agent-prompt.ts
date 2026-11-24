import type { ChatAgent } from "@hx-aioa/protocol";

const VERSION_MARK = "{{version}}";
const NAME_MARK = "{{name}}";
// 插件没写定时时的默认间隔 (秒)
const DEFAULT_INTERVAL_S = 3600;

// FNV-1a 32 位, 只用来给指令内容打版本号
function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// 接入语: 一段话整段复制给任何 Agent; 只让它装命令行, 登录, 拉专属指令, 规则都在专属指令里
export function agentBootstrap(base: string, title: string, key: string, job?: { interval?: number; task?: string }): string {
  const ask = job
    ? `然后每 ${job.interval ?? DEFAULT_INTERVAL_S} 秒: ${job.task ?? `按专属指令整理群 "${title}" 的新消息。`}`
    : "之后我在你这边布置的任务, 结果用 hxaioa send 发到这个群。";
  return [
    `帮我接入 HX-AIOA 群 "${title}"。用命令行 hxaioa (需要 Node 22+), 按顺序执行:`,
    "",
    `mkdir -p ~/.local/bin && curl -fsSLo ~/.local/bin/hxaioa ${base}/hxaioa.mjs && chmod +x ~/.local/bin/hxaioa`,
    `hxaioa login ${base} ${key}`,
    "hxaioa guide --ack",
    "",
    `把 guide 打印的专属指令原样存进你的长期指令并照做。${ask}`,
  ].join("\n");
}

// 专属指令: 服务端按 key 现算, 读权限一改版本就变, Agent 自己重新拉取
export function agentGuide(base: string, channel: string, title: string, agent: ChatAgent, plugin?: string): { text: string; version: string } {
  const lines = [
    `# HX-AIOA 专属指令 (版本 ${VERSION_MARK})`,
    "",
    `你是 "${NAME_MARK}", 在主人的群 "${title}" (\`${channel}\`)。一切操作用已登录的 hxaioa:`,
    "",
    "- 发到本群: `hxaioa send \"文字\"`, 引用某条加 `--reply <seq>`",
    "- 读新消息: `hxaioa read --new` (自动记住读到哪)",
    "- 等主人回话: `hxaioa watch --once --timeout 300` (长连, 等到一条就退出, 超时退出码 2)",
    "- 其它接口: `hxaioa api <METHOD> <路径> [JSON]`",
  ];
  const others = agent.reads.filter((r) => r !== channel);
  if (others.length) lines.push(`- 还能读: ${others.map((r) => `\`${r}\``).join(", ")}, 用 \`-c <群>\``);
  if (plugin) lines.push("", plugin);
  lines.push(
    "",
    "## 保持最新",
    `- 每天第一次干活前, 以及遇到 401 / 403 时, 跑 \`hxaioa guide --ack\`; 版本号变了就用新全文替换本文。第一次报到后发一句 "${NAME_MARK} 已接入"。`,
    "- 密钥只在 hxaioa 配置里, 不要输出或写进任何消息。",
  );
  const body = lines.join("\n");
  // 名字不算进版本: 改名当场生效 (来源名即时改), 不用等 Agent 重新报到
  const version = fnv(body);
  return { text: body.replaceAll(VERSION_MARK, version).replaceAll(NAME_MARK, agent.name), version };
}
