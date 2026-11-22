import assert from "node:assert/strict";
import { test } from "node:test";
import { buildGroups, buildOverview, groupContext } from "../src/group";
import { NOW, ev } from "./fixtures";

const MIN = 60_000;

test("同一 groupKey: 第一条未闭环的是根因, 后续带上根因 id", () => {
  const root = ev({ groupKey: "host:nas", ts: NOW - 10 * MIN, data: { title: "nas 掉线" } });
  const child = ev({ groupKey: "host:nas", ts: NOW - 5 * MIN, root: root.id, data: { title: "容器离线" } });
  const next = ev({ groupKey: "host:nas", data: { title: "网站不可达" } });
  const c = groupContext(next, [root, child], NOW);
  assert.deepEqual(c.groupRoot, { id: root.id, count: 2 });
  assert.equal(c.recentSame, 0);
});

test("根因已恢复或超出窗口则开新组", () => {
  const closed = ev({ groupKey: "g", ts: NOW - MIN, resolved: true });
  assert.equal(groupContext(ev({ groupKey: "g" }), [closed], NOW).groupRoot, undefined);
  const old = ev({ groupKey: "g", ts: NOW - 7 * 3600_000 });
  assert.equal(groupContext(ev({ groupKey: "g" }), [old], NOW).groupRoot, undefined);
});

test("同类合并只看 60 秒内同来源同 subject 同标题, 并排除自己", () => {
  const a = ev({ ts: NOW - 30_000, subject: "nas" });
  const b = ev({ ts: NOW - 120_000, subject: "nas" });
  const self = ev({ subject: "nas" });
  assert.equal(groupContext(self, [a, b, self], NOW).recentSame, 1);
  assert.equal(groupContext(ev({ subject: "vps" }), [a], NOW).recentSame, 0);
});

test("事件组统计条数, 未闭环数与最高优先级", () => {
  const a = ev({ groupKey: "g", ts: NOW - 3 * MIN });
  const b = ev({ groupKey: "g", ts: NOW - MIN, priority: "need_me", root: a.id });
  const c = ev({ groupKey: "g", resolved: true, root: a.id });
  const [g] = buildGroups([c, a, b, ev()]);
  assert.ok(g);
  assert.equal(g.root, a.id);
  assert.equal(g.count, 3);
  assert.equal(g.open, 2);
  assert.equal(g.priority, "need_me");
  assert.deepEqual(g.ids, [a.id, b.id, c.id]);
});

test("总览: 按层分组折叠, drop 与已闭环不显示, digest 进值得一看", () => {
  const evs = [
    ev({ priority: "need_me", route: { action: "alert", channels: ["ws"] } }),
    ev({ groupKey: "g", ts: NOW - MIN }),
    ev({ groupKey: "g", ts: NOW - 2 * MIN }),
    ev({ route: { action: "drop", channels: [] } }),
    ev({ resolved: true }),
    ev({ route: { action: "digest", channels: ["ws"] } }),
    ev({ ts: NOW - 2 * 24 * 3600_000 }),
  ];
  const o = buildOverview(evs, [], NOW);
  assert.equal(o.layers.need_me.length, 1);
  assert.equal(o.layers.happening.length, 1);
  assert.equal(o.layers.happening[0]?.count, 2);
  assert.equal(o.layers.worth_reading.length, 1);
});
