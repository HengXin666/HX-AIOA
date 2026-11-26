// 简报: GET next 按本地版本只在变化时拿全文, 缓存在 ~/.hxaioa/brief.json; 打印成给模型读的纯文本
import { loadBrief, saveBrief } from "./config.mjs";
import { call } from "./http.mjs";
import { PATH_AGENT_NEXT } from "./proto.mjs";

/**
 * start: 本轮第一次 (带 start=1&memory=1); force: 不报本地版本, 一定拿全文 (skill install 用)。
 * 返回服务端的 AgentNext, 另加 current: 当前简报 (新拿的或与版本一致的缓存, 都没有为 null)。
 */
export async function getNext(cfg, { start = false, force = false } = {}) {
  const cached = loadBrief();
  const q = new URLSearchParams({ brief: force ? "" : (cached.version ?? "") });
  if (start) {
    q.set("start", "1");
    q.set("memory", "1");
  }
  const r = await call(cfg, "GET", `${PATH_AGENT_NEXT}?${q}`);
  if (r.brief) saveBrief(r.brief);
  const current = r.brief ?? (cached.version && cached.version === r.briefVersion ? cached : null);
  return { ...r, pending: r.pending ?? [], current };
}

const json = (v) => JSON.stringify(v);

export function formatBrief(b) {
  const out = [`== 简报 ${b.version}`, `我: ${b.name}  群: ${b.title} (${b.channel})`];
  if (b.reads?.length) out.push(`可读的群: ${b.reads.join(", ")}`);
  if (b.plugin) out.push(`插件: ${b.plugin.id}@${b.plugin.version}`);
  if (b.skills?.length) out.push(`skill: ${b.skills.map((s) => `${s.id}@${s.version}`).join(", ")}`);
  if (b.trigger) out.push(`触发: ${b.trigger.expr}${b.trigger.every ? ` (约每 ${b.trigger.every} 秒)` : ""}`);
  for (const m of b.missing ?? []) out.push(`缺大版本 ${m.version}: ${m.changes}; 不升级会少: ${m.missing}${m.until ? `; 兼容到 ${m.until}` : ""}`);
  if (b.view) out.push(`界面: ${json(b.view)}`);
  if (b.feedTags?.length) out.push(`标签: ${json(b.feedTags)}`);
  return out.join("\n");
}
