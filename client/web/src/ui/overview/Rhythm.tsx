import { Skeleton } from "@hx/ui/ui/skeleton";
import { Box } from "lucide-react";
import { lazy, Suspense, useMemo } from "react";
import { useActivity } from "../shell/activity";
import { Quiet, Section } from "./parts";
import { useLight3D } from "./use3d";

const Bar3D = lazy(() => import("@hx/ui/data/3d").then((m) => ({ default: m.Bar3D })));

const H = 280;
const HOURS = 24;
const DAYS = ["一", "二", "三", "四", "五", "六", "日"];
const X = Array.from({ length: HOURS }, (_, h) => String(h));
const Y = DAYS.map((d) => `周${d}`);

// 一周节奏 (#155): 星期 × 钟点的消息量, 3D 柱子可拖动旋转。
// 3D 只在卡片进入视口, 浏览器空闲, 且不是省流量 / 慢网时才加载 (three.js 由 HX-UI 按需拉取, 不进首包)。
export function Rhythm({ className }: { className?: string }) {
  const events = useActivity();
  const { ref, ok, reason } = useLight3D();
  const values = useMemo(() => {
    const v = DAYS.map(() => new Array<number>(HOURS).fill(0));
    for (const e of events ?? []) {
      const d = new Date(e.ts);
      v[(d.getDay() + 6) % 7]![d.getHours()]! += 1;
    }
    return v;
  }, [events]);
  const total = events?.length ?? 0;
  return (
    <Section title="一周节奏" icon={<Box />} tone="accent" className={className} hint="星期 × 钟点的消息数, 拖动旋转, 滚轮缩放">
      <div ref={ref} style={{ minHeight: H }} className="flex">
        {!events ? (
          <Skeleton className="w-full rounded-lg" style={{ height: H }} />
        ) : !total ? (
          <Quiet icon={<Box />}>还没有消息</Quiet>
        ) : !ok ? (
          reason ? <Quiet icon={<Box />}>{reason}</Quiet> : <Skeleton className="w-full rounded-lg" style={{ height: H }} />
        ) : (
          <Suspense fallback={<Skeleton className="w-full rounded-lg" style={{ height: H }} />}>
            <Bar3D values={values} xLabels={X} yLabels={Y} colorMode="value" valueLabel="条" height={H} label="一周节奏" className="w-full" />
          </Suspense>
        )}
      </div>
    </Section>
  );
}
