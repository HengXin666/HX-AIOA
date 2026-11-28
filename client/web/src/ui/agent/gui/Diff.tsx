// 增删行数: +12 -3
export function AddDel({ add, del }: { add: number; del: number }) {
  if (!add && !del) return null;
  return (
    <span className="shrink-0 font-mono text-xs tabular-nums">
      {add > 0 && <span className="text-success">+{add}</span>}
      {add > 0 && del > 0 && " "}
      {del > 0 && <span className="text-destructive">-{del}</span>}
    </span>
  );
}
