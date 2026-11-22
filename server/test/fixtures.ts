import type { Envelope, EventData } from "@hx-aioa/protocol";

export const NOW = Date.UTC(2026, 10, 18, 4, 0);
export const TZ = "Asia/Shanghai";

let seq = 0;

export function ev(over: Partial<Envelope> & { data?: Partial<EventData> } = {}): Envelope {
  seq += 1;
  const { data, ...rest } = over;
  return {
    id: `e_${seq}`,
    seq,
    ts: NOW,
    kind: "event",
    source: { id: "src_nas", name: "NAS", type: "webhook" },
    priority: "happening",
    data: { title: "磁盘温度过高", severity: "warning", ...data },
    ...rest,
  } as Envelope;
}
