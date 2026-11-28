// 市场 CI 用: 客户端构建号是否真实发布过 (#156)。安卓看 Release 标签 android-N, Web 看 main 上成功的部署运行号;
// 查不到 (离线, 没有 gh 授权) 时返回 undefined, 由 checkManifest 退回能力表的 known 并给警告
import { execFileSync } from "node:child_process";
import type { ClientKind, Released } from "@hx-aioa/protocol";

const TIMEOUT_MS = 20_000;
// 安卓标签所在的远端: 本仓库默认 origin; 别的市场仓库跑本脚本时可设 AIOA_REMOTE=https://github.com/HengXin666/HX-AIOA.git
const REMOTE = process.env.AIOA_REMOTE ?? "origin";
const DEPLOY_WORKFLOW = "deploy.yml";
const RUNS_LIMIT = "500";

function run(cmd: string, args: string[], cwd: string): string | null {
  try {
    return execFileSync(cmd, args, { cwd, encoding: "utf8", timeout: TIMEOUT_MS, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

function androidTags(cwd: string): Set<number> | null {
  const out = run("git", ["ls-remote", "--tags", REMOTE, "android-*"], cwd);
  if (out === null) return null;
  const nums = [...out.matchAll(/refs\/tags\/android-(\d+)$/gm)].map((m) => Number(m[1]));
  return nums.length ? new Set(nums) : null;
}

function webRuns(cwd: string): Set<number> | null {
  const out = run("gh", ["run", "list", "--workflow", DEPLOY_WORKFLOW, "--branch", "main", "--status", "success", "--limit", RUNS_LIMIT, "--json", "number"], cwd);
  if (out === null) return null;
  try {
    const nums = (JSON.parse(out) as { number: number }[]).map((r) => r.number);
    return nums.length ? new Set(nums) : null;
  } catch {
    return null;
  }
}

/** 在 cwd (HX-AIOA 仓库) 里查一次发布记录, 返回给 checkManifest 用的查询函数; notes 记下离线降级的说明。 */
export function releasedLookup(cwd: string, notes: string[]): Released {
  const sets: Record<ClientKind, Set<number> | null> = { android: androidTags(cwd), web: webRuns(cwd) };
  if (!sets.android) notes.push(`查不到安卓 Release 标签 (git ls-remote ${REMOTE} 失败), 安卓构建号只按能力表检查`);
  if (!sets.web) notes.push(`查不到 Web 部署记录 (gh run list ${DEPLOY_WORKFLOW} 失败或没有 GH_TOKEN), Web 构建号只按能力表检查`);
  return (kind, build) => {
    const set = sets[kind];
    if (!set) return undefined;
    if (set.has(build)) return true;
    // 比查到的最早一次还早: 超出查询窗口, 当查不到
    return build < Math.min(...set) ? undefined : false;
  };
}
