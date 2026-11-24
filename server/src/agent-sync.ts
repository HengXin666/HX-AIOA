import { HEADER_GUIDE_VERSION, PATH_AGENT_GUIDE, PATH_AGENT_GUIDE_ACK, type ChatAgent, type ChatMeta, type RouteInfo } from "@hx-aioa/protocol";
import { agentGuide } from "./agent-prompt";
import { baseOf, saveAgents } from "./api-chats";
import { messageInput } from "./api-events";
import type { Core, Principal } from "./core";

// 指令更新通知: 服务端以 "系统" 身份发到 Agent 所在的群, 不响铃
const NOTICE_SOURCE = { id: "system:guide", name: "系统", icon: "refresh-cw" };
const NOTICE_ROUTE: RouteInfo = { action: "silent", channels: ["ws"], reason: "指令更新" };
const CLI_UA = /hxaioa-cli\/([\w.-]+)/;
const API_CLIENT = "接口";
const SWITCHING = 101;
// 拉指令 / 报到本身不触发 "请更新" 通知
const QUIET_PATHS = [PATH_AGENT_GUIDE, PATH_AGENT_GUIDE_ACK];

/** 专属指令: 插件 Agent 带插件提示词, 信息流群带 feed 格式。 */
export function guideFor(core: Core, base: string, channel: string, agent: ChatAgent) {
  const meta = core.chats.chat(channel);
  const title = meta?.title || channel;
  const plugin = agent.plugin ? core.plugins.promptFor(agent.plugin, base, channel, title) : undefined;
  return agentGuide(base, channel, title, agent, plugin, meta?.view);
}

/** 这把 key 对应的群 Agent。 */
export function agentOfKey(core: Core, keyId: string): { meta: ChatMeta; agent: ChatAgent } | null {
  for (const meta of core.chats.chats()) {
    const agent = meta.agents?.find((a) => a.keyId === keyId);
    if (agent) return { meta, agent };
  }
  return null;
}

/** UA 里认出 hxaioa 命令行及版本, 否则算直接调接口。 */
export function clientOf(req: Request): string {
  const m = CLI_UA.exec(req.headers.get("User-Agent") ?? "");
  return m ? `hxaioa ${m[1]}` : API_CLIENT;
}

function replace(core: Core, meta: ChatMeta, agent: ChatAgent): void {
  saveAgents(core, meta.channel, (meta.agents ?? []).map((x) => (x.keyId === agent.keyId ? agent : x)));
}

async function notice(core: Core, channel: string, text: string): Promise<void> {
  const input = messageInput({ text });
  if (typeof input === "string") return;
  input.channel = channel;
  await core.pipeline.fromInput(input, { source: NOTICE_SOURCE }, NOTICE_ROUTE);
}

/**
 * Agent 的每个请求: 响应头带上当前指令版本 (hxaioa 据此提示更新);
 * 已报到过的 Agent 指令版本变了, 在群里发一次通知, 标成待更新。
 */
export async function stampGuide(core: Core, req: Request, url: URL, who: Principal, res: Response): Promise<Response> {
  if (who.owner || who.member || res.status === SWITCHING) return res;
  const hit = agentOfKey(core, who.key.id);
  if (!hit) return res;
  const { meta, agent } = hit;
  const g = guideFor(core, baseOf(url), meta.channel, agent);
  const out = new Response(res.body, res);
  out.headers.set(HEADER_GUIDE_VERSION, g.version);
  const stale = agent.joined && agent.version !== g.version && agent.notified !== g.version;
  if (stale && !QUIET_PATHS.includes(url.pathname)) {
    replace(core, meta, { ...agent, notified: g.version, pending: true });
    await notice(core, meta.channel, `${agent.name} 的专属指令已更新到 ${g.version}: 下次干活前先运行 hxaioa guide --ack, 用新全文替换旧指令。`);
  }
  return out;
}

/** 报到成功: 记下版本与客户端; 版本有变时由服务端在群里记一笔, 不用 Agent 自己发。 */
export async function acked(core: Core, req: Request, meta: ChatMeta, agent: ChatAgent, version: string): Promise<void> {
  const client = clientOf(req);
  replace(core, meta, { ...agent, joined: Date.now(), pending: false, version, client, notified: version });
  if (agent.joined && agent.version !== version) await notice(core, meta.channel, `${agent.name} 已更新到专属指令 ${version} (${client})。`);
}
