import type { ContentBlock } from "../../../agentgui/types";

const TOKEN_RE = /(?:^|\s)@([^\s@]+[^\s@/])(?=\s|$)/g;

// 发送时把 @路径 变成 ACP resource_link (所有 Agent 都必须支持), 文字里的 @路径 原样保留
export function toLinks(text: string, cwd?: string): ContentBlock[] {
  if (!cwd) return [];
  const seen = new Set<string>();
  const out: ContentBlock[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    const p = m[1] as string;
    if (seen.has(p)) continue;
    seen.add(p);
    out.push({ type: "resource_link", uri: `file://${cwd.replace(/\/$/, "")}/${p}`, name: p.split("/").pop() ?? p });
  }
  return out;
}
