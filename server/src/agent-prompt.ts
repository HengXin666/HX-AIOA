import type { ChatAgent } from "@hx-aioa/protocol";
import { PATH_AGENT_GUIDE, PATH_AGENT_GUIDE_ACK } from "@hx-aioa/protocol";

const UA_LINE = "`User-Agent: hx-aioa-agent/1`";
const VERSION_MARK = "{{version}}";
const NAME_MARK = "{{name}}";
// 插件没写定时时的默认间隔 (秒)
const DEFAULT_INTERVAL_S = 3600;
// 通用说明放在仓库文档里长期维护, 专属指令只写这个 Agent 自己的信息
const DOC_URL = "https://github.com/HengXin666/HX-AIOA/blob/main/docs/agent-guide.md";

// FNV-1a 32 位, 只用来给指令内容打版本号
function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// 接入语: 一段话整段复制给任何 Agent, 用户可以直接改定时和任务。
// 细节都在仓库文档和专属指令里, 这里只给文档链接, 服务地址, 任务和密钥。
export function agentBootstrap(base: string, title: string, key: string, job?: { interval?: number; task?: string }): string {
  const head = `你看一下 ${DOC_URL} 这个文档, 帮我接入 HX-AIOA (服务地址 ${base}, 群 "${title}")`;
  const ask = job
    ? `${head}, 然后帮我每 ${job.interval ?? DEFAULT_INTERVAL_S} 秒完成以下任务:\n${job.task ?? `整理群 "${title}" 的新消息, 具体规则见接入后拉到的专属指令。`}`
    : `${head}, 之后我在你这边布置的任务, 结果发到这个群。`;
  return `${ask}\n\nAPI 密钥: ${key}`;
}

// 完整指令: 服务端按 key 现算, 读权限一改版本就变, Agent 自己重新拉取
export function agentGuide(base: string, channel: string, title: string, agent: ChatAgent, plugin?: string): { text: string; version: string } {
  const lines = [
    `# HX-AIOA 专属指令 (版本 ${VERSION_MARK})`,
    "",
    `你是 "${NAME_MARK}", 往主人的群 "${title}" (channel: \`${channel}\`) 发消息。本文由服务端生成, 原样保存, 不要改写。`,
    `接口用法 (发消息, HTML 卡片, 报告, 读群, 撤回) 见 ${DOC_URL}, 每天开工前重读; 和本文冲突时以本文为准。`,
    "",
    `- 服务地址: ${base}`,
    `- 每个请求带 \`Authorization: Bearer <密钥>\` 和 ${UA_LINE}, 否则会被防火墙拦截。`,
    `- 发到本群: POST ${base}/api/v1/messages, body \`{ "text": "..." }\`, 不写 channel 就是本群。`,
  ];
  if (agent.reads.length) {
    lines.push(`- 可读的群: ${agent.reads.map((r) => `\`${r}\``).join(", ")}。读法: GET ${base}/api/v1/chats/<channel>/messages?since=<上次的 head>&limit=100。`);
  }
  if (plugin) lines.push("", plugin);
  lines.push(
    "",
    "## 保持最新与报到",
    `- 每天第一次干活前, 以及遇到 401 / 403 时, 重新 GET ${base}${PATH_AGENT_GUIDE}; 响应头 \`X-Aioa-Guide-Version\` 变了就整段替换本文, 再报到。`,
    `- 报到: POST ${base}${PATH_AGENT_GUIDE_ACK}, body \`{ "version": "${VERSION_MARK}" }\`; 返回 409 说明不是最新, 重新拉取。第一次报到后往本群发一句 "${NAME_MARK} 已接入"。`,
    "- 密钥只放请求头, 不输出, 不写进公开文件。每分钟最多 60 次请求, 失败按指数退避。",
  );
  const body = lines.join("\n");
  // 名字不算进版本: 改名当场生效 (来源名即时改), 不用等 Agent 重新报到
  const version = fnv(body);
  return { text: body.replaceAll(VERSION_MARK, version).replaceAll(NAME_MARK, agent.name), version };
}
