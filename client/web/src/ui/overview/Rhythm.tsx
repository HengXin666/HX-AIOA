import { Skeleton } from "@hx/ui/ui/skeleton";
import { Box } from "lucide-react";
import { useMemo } from "react";
import { useActivity } from "../shell/activity";
import { Bar3DLazy } from "./Bar3DLazy";
import { Quiet, Section } from "./parts";

const H = 280;
const HOURS = 24;
const DAYS = ["一", "二", "三", "四", "五", "六", "日"];
const X = Array.from({ length: HOURS }, (_, h) => String(h));
const Y = DAYS.map((d) => `周${d}`);

// 一周节奏 (#155): 星期 × 钟点的消息量, 3D 柱子可拖动旋转
export function Rhythm({ className }: { className?: string }) {
  const events = useActivity();
  const values = useMemo(() => {
    const v = DAYS.map(() => new Array<number>(HOURS).fill(0));
    for (const e of events ?? []) {
      const d = new Date(e.ts);
      v[(d.getDay() + 6) % 7]![d.getHours()]! += 1;
    }
    return v;
  }, [events]);
  return (
    <Section title="一周节奏" icon={<Box />} tone="accent" className={className} hint="星期 × 钟点的消息数, 拖动旋转, 滚轮缩放">
      {!events ? (
        <Skeleton className="w-full rounded-lg" style={{ height: H }} />
      ) : !events.length ? (
        <Quiet icon={<Box />}>还没有消息</Quiet>
      ) : (
        <Bar3DLazy values={values} x={X} y={Y} unit="条" label="一周节奏" height={H} />
      )}
    </Section>
  );
}
