import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CATEGORY_OF,
  ITEM_TYPES,
  normalizeMetricValues,
  orderPanels,
  panelSizeOf,
  parseSpaceState,
  stepSize,
  validateSpace,
  type EventInput,
  type MetricData,
  type Space,
} from "@hx-aioa/protocol";
import { runAdapter } from "../src/adapters";
import type { MetricRouter } from "../src/metrics";
import { resolveSpaceData } from "../src/space-data";
import { ev } from "./fixtures";

const PUSH = { mode: "push" } as const;
const NAS = "nas-01";
const CPU = "cpu";
const CPU_Q = "NAS 现在忙不忙?";
const P_NAS = "nas";
const P_OPS = "ops";
const FULL = "full";
const RESTART = "restart";
const space = (): Space => ({
  id: "servers",
  title: "服务器",
  panels: [
    {
      id: P_NAS,
      title: "NAS",
      refresh: PUSH,
      items: [
        { id: "cpu", type: "ring", question: CPU_Q, bind: [{ subject: NAS, field: CPU }] },
        { id: "trend", type: "line", question: "CPU 最近一小时有没有尖峰?", bind: [{ subject: NAS, field: CPU, range: "1h" }] },
      ],
    },
    { id: "feed", title: "动态", size: "l", refresh: PUSH, items: [{ id: "ev", type: "list", bind: [{ subject: NAS, field: "events" }] }] },
    { id: P_OPS, title: "操作", refresh: PUSH, items: [{ id: RESTART, type: "button", action: { agent: "dsh", command: RESTART } }] },
  ],
});
const metric = (r: EventInput[] | string) => {
  assert.ok(Array.isArray(r) && r[0]?.kind === "metric", `应返回指标: ${String(r)}`);
  return r[0] as EventInput & { data: MetricData };
};

test("每种组件都有分类, 合法布局通过校验", () => {
  for (const t of ITEM_TYPES) assert.ok(CATEGORY_OF[t], t);
  assert.deepEqual(validateSpace(space()), []);
});

test("校验拒绝坏输入并列出全部问题", () => {
  const bad = space();
  bad.panels[0]!.items = [
    { id: "a", type: "sparkline", bind: [{ subject: NAS, field: CPU }] },
    { id: "b", type: "value", question: CPU_Q } as never,
    { id: "c", type: "line", question: CPU_Q, bind: [{ subject: NAS, field: CPU, range: "一小时" }] },
    { id: RESTART, type: "nope" as never },
  ];
  bad.panels[1]!.size = "xl" as never;
  const errs = validateSpace(bad);
  const has = (s: string) => assert.ok(errs.some((e) => e.includes(s)), `缺少错误 ${s}: ${errs.join(" | ")}`);
  has("需要 question");
  has("value 需要至少一个 bind");
  has("range 格式");
  has("未知组件类型 nope");
  has("在工作台内重复");
  has("size 只能是");
  assert.deepEqual(validateSpace("x"), ["space 必须是对象"]);
});

test("显示状态: 尺寸与排序合并保存, 未知面板与非法尺寸被拒", () => {
  const s = space();
  const next = parseSpaceState({ order: [P_OPS, P_NAS], sizes: { [P_NAS]: FULL } }, s, { hiddenPanels: ["feed"] });
  assert.ok(typeof next !== "string");
  s.state = next;
  assert.deepEqual(orderPanels(s).map((p) => p.id), [P_OPS, P_NAS]);
  assert.equal(panelSizeOf(s, s.panels[0]!), FULL);
  assert.equal(panelSizeOf(s, s.panels[2]!), "m");
  assert.match(String(parseSpaceState({ sizes: { [P_NAS]: "huge" } }, s)), /sizes 取值错误/);
  assert.match(String(parseSpaceState({ order: ["ghost"] }, s)), /不存在的面板: ghost/);
  assert.match(String(parseSpaceState({ order: [P_NAS, P_NAS] }, s)), /重复/);
  assert.match(String(parseSpaceState([], s)), /必须是对象/);
  assert.equal(stepSize(FULL, 1), FULL);
  assert.equal(stepSize("m", -1), "s");
});

test("指标字段与来源无关: Beszel, Netdata, Prometheus 都产出标准 cpu/mem", () => {
  const h = new Headers();
  const beszel = metric(runAdapter("beszel", { body: { name: NAS, status: "up", info: { cpu: 12.5, mp: 40, dp: 71, c: 8 } }, headers: h, source: { name: "b" } }));
  assert.equal(beszel.subject, NAS);
  assert.deepEqual(beszel.data.values, { cpu: 12.5, mem: 40, disk: 71, up: 1 });
  const allmetrics = {
    "system.cpu": { dimensions: { user: { value: 10 }, system: { value: 5 }, idle: { value: 85 } } },
    "system.ram": { dimensions: { used: { value: 2 }, free: { value: 6 } } },
    "system.load": { dimensions: { load1: { value: 0.7 } } },
  };
  const nd = metric(runAdapter("netdata", { body: allmetrics, headers: h, source: { name: "n", subject: NAS } }));
  assert.deepEqual(nd.data.values, { cpu: 15, mem: 25, load: 0.7 });
  const prom = metric(runAdapter("prometheus", { body: { metric: { instance: "nas-01:9100", field: CPU }, value: [1_700_000_000, "33.3"] }, headers: h, source: { name: "p" } }));
  assert.equal(prom.subject, NAS);
  assert.deepEqual(prom.data.values, { cpu: 33.3 });
  assert.equal(prom.ts, 1_700_000_000_000);
  assert.deepEqual(normalizeMetricValues({ memory: 1, mem: 2, temperature: 50 }), { mem: 2, temp: 50 });
  assert.equal(typeof runAdapter("prometheus", { body: { metric: {} }, headers: h, source: { name: "p" } }), "string");
});

test("服务端按绑定解析当前值与最近事件", () => {
  const router = { latestOf: (subjects: string[]) => (subjects.includes(NAS) ? { [NAS]: { ts: 5, values: { cpu: 42 } } } : {}) } as unknown as MetricRouter;
  const recent = [ev({ seq: 1, subject: NAS }), ev({ seq: 2, subject: "other" }), ev({ seq: 3, subject: NAS })];
  const data = resolveSpaceData(space(), router, recent, 9);
  assert.deepEqual(data.values, [{ subject: NAS, field: CPU, value: 42, ts: 5, unit: "%" }]);
  assert.deepEqual(data.events.map((e) => e.seq), [3, 1]);
});
