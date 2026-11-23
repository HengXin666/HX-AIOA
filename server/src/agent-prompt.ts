import type { ChatAgent } from "@hx-aioa/protocol";
import { PATH_AGENT_GUIDE, PATH_AGENT_GUIDE_ACK } from "@hx-aioa/protocol";

const UA_LINE = "`User-Agent: hx-aioa-agent/1`";
const VERSION_MARK = "{{version}}";
// 通用说明放在仓库文档里长期维护, 专属指令只写这个 Agent 自己的信息
const DOC_URL = "https://github.com/HengXin666/HX-AIOA/blob/main/docs/agent-guide.md";
const DOC_RAW = "https://raw.githubusercontent.com/HengXin666/HX-AIOA/main/docs/agent-guide.md";

// FNV-1a 32 位, 只用来给指令内容打版本号
function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// 交给外部 Agent 的一句话: 只负责让它去拉完整指令并原样保存, 主人不用写提示词
export function agentBootstrap(base: string, agent: ChatAgent, key: string): string {
  return [
    `你是 "${agent.name}", 现在接入我的消息中心 HX-AIOA。按顺序做, 不要跳过:`,
    `1. 请求 GET ${base}${PATH_AGENT_GUIDE}, 请求头 \`Authorization: Bearer <密钥>\` 和 ${UA_LINE}。`,
    "2. 把返回的全文原样写进你的长期指令 (AGENTS.md / CLAUDE.md / 记忆等每次都会读的地方), 一字不改, 不要总结或删减。",
    "3. 密钥单独存进本地私密配置 (如环境变量 AIOA_KEY), 不要写进会提交或公开的文件。",
    `4. 读完整接入说明 ${DOC_RAW} (给人看的版本: ${DOC_URL}), 把链接也写进长期指令, 每天开工前重读一遍。`,
    "5. 按专属指令最后 \"报到\" 一节完成报到。",
    "",
    `密钥: ${key}`,
  ].join("\n");
}

// 完整指令: 服务端按 key 现算, 读权限一改版本就变, Agent 自己重新拉取
export function agentGuide(base: string, channel: string, title: string, agent: ChatAgent): { text: string; version: string } {
  const lines = [
    `# HX-AIOA 接入指令 (版本 ${VERSION_MARK})`,
    "",
    `你是 "${agent.name}", 负责往主人的群 "${title}" (channel: ${channel}) 发消息。本文由服务端生成, 必须原样保存, 不得改写。`,
    "",
    `完整接入说明 (发消息, HTML 卡片, 读群, 撤回删除, 错误处理): ${DOC_RAW}`,
    "每天开工前重读一遍; 和本文冲突时以本文为准。",
    "",
    "## 什么时候发",
    "- 主人会直接在你这边给你布置任务, 任务的结果需要主人看时, 发到本群。",
    "- 主人说 \"原样发\" 或给出引号里的内容时, 一字不改地发送, 不加任何前后缀。",
    "- 只发结果, 不发过程; 同一件事合并成一条, 不刷屏。",
    "",
    "## 接口",
    `- 服务地址: ${base}`,
    `- 每个请求都带 \`Authorization: Bearer <你保存的密钥>\` 和 ${UA_LINE} (默认 UA 会被防火墙拦截)。`,
    "",
    "### 发消息到本群",
    `POST ${base}/api/v1/messages`,
    "```json",
    '{ "text": "支持 **Markdown** 的正文", "title": "可选标题" }',
    "```",
    '- 不写 channel 就发到本群。需要主人马上处理的加 `"priority": "need_me"`。',
    '- 想自己排版 (卡片, 周报) 就另加 `"html": "<div>...</div>"`, `text` 仍写一句纯文字摘要 (通知用)。HTML 不执行脚本, 不联网: 样式写内联, 图片用 data:, 上限 64KB。App 有白天/黑夜两种主题: 没写颜色的文字会跟随主题; 自己写了颜色或背景, 请用 `@media (prefers-color-scheme: dark) {...}` 再给一套深色。',
    "",
    "### 发日报 / 周报 (长文)",
    `POST ${base}/api/v1/events`,
    "```json",
    '{ "kind": "report", "data": { "title": "2026-01-01 日报", "summary": "一句话摘要", "markdown": "# 正文..." } }',
    "```",
  ];
  if (agent.reads.length) {
    lines.push(
      "",
      "### 读群消息",
      `可读的群: ${agent.reads.map((r) => `\`${r}\``).join(", ")}`,
      `GET ${base}/api/v1/chats/<channel>/messages?since=<上次的 head>&limit=100`,
      '返回 `{ "messages": [...], "head": 123 }`, 记住 head 下次接着读, 只处理增量。正文在 `data.title` / `data.summary` (报告是 `data.markdown`)。',
    );
  }
  lines.push(
    "",
    "### 撤回与删除",
    `- 撤回自己发的: DELETE ${base}/api/v1/events/seq/<seq>?mode=recall, 没有时间限制。`,
    `- 删除本群任何消息: DELETE ${base}/api/v1/events/seq/<seq>?mode=delete。只在主人要求或发错时用。`,
  );
  lines.push(
    "",
    "## 规则",
    "- 每分钟最多 60 次请求; 失败按指数退避重试。",
    "- 密钥只用于上面的接口, 不要输出, 不要写进公开文件。",
    `- 每天第一次干活前, 以及遇到 401 / 403 时, 重新 GET ${base}${PATH_AGENT_GUIDE}: 响应头 \`X-Aioa-Guide-Version\` 和你保存的版本不同, 就用新全文整段替换旧的, 再报到一次。`,
    "",
    "## 报到",
    `1. POST ${base}${PATH_AGENT_GUIDE_ACK}, body \`{ "version": "${VERSION_MARK}" }\`。返回 409 说明你拿到的不是最新版, 重新拉取。`,
    `2. 往本群发一条: "${agent.name} 已接入", 再用一句话说明你能做什么。`,
  );
  const body = lines.join("\n");
  const version = fnv(body);
  return { text: body.replaceAll(VERSION_MARK, version), version };
}
