import { Skeleton } from "@hx/ui/ui/skeleton";
import { Box } from "lucide-react";
import { lazy, Suspense } from "react";
import { Quiet } from "./parts";
import { useLight3D } from "./use3d";

const Bar3D = lazy(() => import("@hx/ui/data/3d").then((m) => ({ default: m.Bar3D })));

type Props = { values: number[][]; x: string[]; y: string[]; unit: string; label: string; height: number };

// HX-UI 3D 柱图的懒加载外壳: 进入视口且空闲才拉 three.js; 省流量 / 慢网只给一句说明, 数据卡片不受影响
export function Bar3DLazy({ values, x, y, unit, label, height }: Props) {
  const { ref, ok, reason } = useLight3D();
  const ph = <Skeleton className="w-full rounded-lg" style={{ height }} />;
  return (
    <div ref={ref} style={{ minHeight: height }} className="flex">
      {reason ? (
        <Quiet icon={<Box />}>{reason}</Quiet>
      ) : !ok ? (
        ph
      ) : (
        <Suspense fallback={ph}>
          <Bar3D values={values} xLabels={x} yLabels={y} colorMode="value" valueLabel={unit} height={height} label={label} className="w-full" />
        </Suspense>
      )}
    </div>
  );
}
