import type { ChatAgent } from "@hx-aioa/protocol";

const KEY_HIDDEN = "<在 App 里点 \"重新接入\" 获取新 key>";

// 交给外部 Agent 的接入提示词: 一段话讲清楚往哪发, 怎么发, 能读什么, 以及主人交代的任务
export function agentPrompt(base: string, channel: string, title: string, agent: ChatAgent, key?: string): string {
  const k = key ?? KEY_HIDDEN;
  const lines = [
    `你是 "${agent.name}", 接入了我的个人消息中心 HX-AIOA, 负责群 "${title}" (channel: ${channel})。`,
    "",
    "## 你的任务",
    agent.brief.trim() || "(主人还没写具体任务, 先发一条自我介绍等待安排)",
    "",
    "## 接入信息",
    `- 服务地址: ${base}`,
    `- 密钥: ${k}`,
    "- 所有请求带请求头 `Authorization: Bearer <密钥>`, 以及自定义 `User-Agent: hx-aioa-agent/1` (默认 UA 可能被防火墙拦截)。",
    "",
    "## 发消息到本群",
    `POST ${base}/api/v1/messages`,
    "```json",
    '{ "text": "支持 **Markdown** 的正文", "title": "可选标题" }',
    "```",
    "- 不写 channel 就发到本群; 正文支持 Markdown (标题, 列表, 代码块, 链接)。",
    '- 重要且需要主人马上看的加 `"priority": "need_me"`, 普通的不用写。',
    "",
    "## 发日报 / 周报 (长文)",
    `POST ${base}/api/v1/events`,
    "```json",
    '{ "kind": "report", "data": { "title": "2026-01-01 日报", "summary": "一句话摘要", "markdown": "# 正文..." } }',
    "```",
  ];
  if (agent.reads.length) {
    lines.push(
      "",
      "## 读群消息",
      `可读的群: ${agent.reads.map((r) => `\`${r}\``).join(", ")}`,
      `GET ${base}/api/v1/chats/<channel>/messages?since=<上次的 head>&limit=100`,
      '返回 `{ "messages": [...], "head": 123 }`, 记住 head 下次接着读, 只处理增量。每条的正文在 `data.title` / `data.summary` (报告是 `data.markdown`)。',
    );
  }
  lines.push("", "## 规则", "- 每分钟最多 60 次请求; 失败按指数退避重试。", "- 密钥只用于上面的接口, 不要泄露或写进公开仓库。");
  return lines.join("\n");
}
