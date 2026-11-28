import { PATH_PROBES } from "@hx-aioa/protocol";
import { api } from "./auth";

// 添加主机 / 补权限 (服务端 api-probes.ts); key 只出现在这一次的回包里
export type NewProbe = { id: string; subject: string; shell: boolean; agent: boolean; key: string; command: string };
export type ScopeResult = { ok: boolean; key?: string; command?: string };

const AGENT_UA = "hx-aioa-agent/1";
const INSTALL_PATH = "/install.sh";
export const SCOPE_AGENT = "probe:agent";

export function createProbe(name: string, opts: { shell: boolean; agent: boolean }): Promise<NewProbe> {
  return api<NewProbe>(PATH_PROBES, { method: "POST", body: JSON.stringify({ name, shell: opts.shell, agent: opts.agent }) });
}

// 已有主机补 scope; 服务端换了新 key 时回 key, 需要用新 key 重装
export function addProbeScope(id: string, add: string[]): Promise<ScopeResult> {
  return api<ScopeResult>(`${PATH_PROBES}/${encodeURIComponent(id)}/scope`, { method: "POST", body: JSON.stringify({ add }) });
}

// 与服务端 createProbe 拼的同一行安装命令
export function installCommand(name: string, key: string, opts: { shell?: boolean; agent?: boolean }): string {
  const origin = location.origin;
  const flags = [`--server ${origin}`, `--key ${key}`, `--name ${name}`, ...(opts.shell ? ["--shell"] : []), ...(opts.agent ? ["--agent"] : [])].join(" ");
  return `curl -fsSL -A ${AGENT_UA} ${origin}${INSTALL_PATH} | sh -s -- ${flags}`;
}
