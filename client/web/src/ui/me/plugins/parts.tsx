import type { ClientFit } from "@hx-aioa/protocol";
import { Badge } from "@hx/ui/ui/badge";
import { FolderGit2, ListChecks, Puzzle, type LucideIcon } from "lucide-react";
import { outdated, type PluginItem } from "../../../core/plugins";
import { seriesOf, tint } from "../../overview/parts";

// 清单里的 Lucide 图标名 -> 组件; 品牌图标 Lucide 1.x 已移除, 用相近的代替, 没登记的用拼图
const ICONS: Record<string, LucideIcon> = {
  github: FolderGit2,
  "list-checks": ListChecks,
  puzzle: Puzzle,
};

export function PluginIcon({
  name,
  i = 0,
  size = "sm",
}: {
  name: string;
  i?: number;
  size?: "sm" | "lg";
}) {
  const Icon = ICONS[name] ?? Puzzle;
  const tone = seriesOf(i);
  const box =
    size === "lg"
      ? "size-12 rounded-xl [&>svg]:size-6"
      : "size-9 rounded-lg [&>svg]:size-[18px]";
  return (
    <span
      className={`grid shrink-0 place-items-center ${box}`}
      style={{ color: tone, background: tint(tone) }}
    >
      <Icon />
    </span>
  );
}

type Dot = "success" | "destructive" | "info" | "muted" | "warning";
/** 一项的状态: 开发中, 可更新, 已安装, 已启用, 待放行 */
export function stateOf(p: PluginItem): { text: string; dot: Dot } | null {
  if (p.foreign) return { text: "别人开发中", dot: "muted" };
  if (p.dev) return { text: "开发中", dot: "info" };
  if (outdated(p))
    return { text: `可更新到 v${p.allowed?.version}`, dot: "info" };
  if (p.installed) return { text: "已安装", dot: "success" };
  if (p.enabled) return { text: "已启用", dot: "success" };
  if (!p.allowed) return { text: "待放行", dot: "muted" };
  return null;
}

/** 按端兼容 (#156): Web 不支持, 或要更新到某个构建号 */
export function FitBadge({ fit }: { fit?: ClientFit }) {
  if (!fit || fit.level === "ok") return null;
  if (fit.level === "unsupported")
    return (
      <Badge variant="outline" dot="warning">
        Web 端界面未适配
      </Badge>
    );
  return (
    <Badge variant="outline" dot="warning">
      需 Web 构建 {fit.need} 以上
    </Badge>
  );
}
