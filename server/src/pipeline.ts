import type { FileStore } from "./files/store";
import {
  defaultPriority,
  type DeliveryChannel,
  type Envelope,
  type EventInput,
  type RouteInfo,
  type Rule,
  type SourceInfo,
  type SourceRef,
} from "@hx-aioa/protocol";
import { typeInfo } from "./adapters";
import { randomId } from "./auth";
import type { Config } from "./config";
import {
  FALLBACK_DELAY_MS,
  HISTORY_MAX_LIMIT,
  KEY_ACKED_SEQ,
  KEY_PENDING_SEQ,
  KEY_PUSH_TOKEN,
  KV_AGG_PREFIX,
  RECENT_SCAN,
  SRC_SYSTEM,
  TIMER_AGG_PREFIX,
  TIMER_FALLBACK,
} from "./constants";
import type { Env } from "./env";
import { groupContext, titleOf } from "./group";
import type { MetricRouter } from "./metrics";
import { hasFallback, sendFallback } from "./notify";
import { PUSH_CHANNELS, aggregateWindowSec, decide, type RuleSets } from "./rules/engine";
import { inWindow } from "./rules/window";
import type { SenderStore } from "./senders";
import type { Sockets } from "./sockets";
import { EventStore } from "./store";
import type { Timers } from "./timers";

type Bucket = { count: number; title: string; rule?: string; subject?: string; channels: DeliveryChannel[] };
type Origin = { source: SourceRef; sourceInfo?: SourceInfo | null; cid?: string; by?: string };

const FALLBACK: DeliveryChannel[] = ["mipush", "wxpusher"];
const ringing = (r: RouteInfo | undefined) => r !== undefined && (r.action === "alert" || r.action === "push");

// 事件处理层: 补全信封 -> 去重覆盖 -> 根因与同类 -> 规则 -> 入库 -> 分发
export class Pipeline {
  constructor(
    private readonly env: Env,
    private readonly storage: DurableObjectStorage,
    private readonly store: EventStore,
    private readonly config: Config,
    private readonly metrics: MetricRouter,
    private readonly sockets: Sockets,
    private readonly timers: Timers,
    private readonly files?: FileStore,
    readonly senders?: SenderStore,
  ) {}

  // 外部写入: EventInput + 来源 -> 信封
  async fromInput(input: EventInput, origin: Origin, fixed?: RouteInfo): Promise<Envelope> {
    const info = origin.sourceInfo;
    const draft = {
      id: "",
      seq: 0,
      ts: input.ts ?? Date.now(),
      kind: input.kind,
      source: origin.source,
      priority: input.priority ?? info?.priority ?? defaultPriority(input.kind, input.data),
      data: input.data,
    } as Envelope;
    const subject = input.subject ?? info?.subject;
    const channel = input.channel ?? info?.channel;
    if (subject) draft.subject = subject;
    if (channel) draft.channel = channel;
    for (const k of ["dedupeKey", "groupKey", "actions", "ttl", "reply", "fwd", "mentions"] as const) if (input[k] !== undefined) Object.assign(draft, { [k]: input[k] });
    if (input.resolved) draft.resolved = true;
    if (origin.cid) draft.cid = origin.cid;
    if (origin.by) draft.by = origin.by;
    return this.ingest(draft, info ?? null, fixed);
  }

  async ingest(draft: Envelope, sourceInfo: SourceInfo | null, fixed?: RouteInfo): Promise<Envelope> {
    const now = Date.now();
    if (draft.kind === "metric") {
      if (draft.subject) this.metrics.ingest(draft.subject, draft.data, draft.ts);
      return draft;
    }
    const dk = EventStore.dedupeOf(draft);
    const previous = draft.id ? this.store.get(draft.id) : dk ? this.store.byDedupe(dk) : null;
    // 系统发送者自动登记, 主人改过名的按别名发 (#128)
    const named: Envelope = { ...draft, id: draft.id || previous?.id || randomId("e_") };
    const ev: Envelope = this.senders?.see(named, now) ?? named;
    if (ev.kind === "event" && ev.data.status === "resolved") ev.resolved = true;
    if (ev.ttl) ev.expires = ev.ts + ev.ttl * 1000;
    const gc = groupContext(ev, this.store.recent(RECENT_SCAN), now);
    if (gc.groupRoot) ev.root = gc.groupRoot.id;
    else if (ev.groupKey) ev.root = previous?.root ?? ev.id;
    const sets = await this.ruleSets(ev, sourceInfo);
    if (fixed) ev.route = fixed;
    else {
      const settings = await this.config.settings();
      const ctx = { now, tz: await this.config.tz(), ...gc, ...(previous ? { previous } : {}), ...(settings.quiet ? { quiet: settings.quiet } : {}) };
      ev.route = decide(ev, sets, ctx);
    }
    const saved = this.store.put(ev);
    await this.files?.track(previous, saved);
    await this.deliver(saved, sets);
    return saved;
  }

  async ruleSets(ev: Envelope, info: SourceInfo | null): Promise<RuleSets> {
    const user = await this.config.rules();
    if (info?.rules?.length) return { user, source: info.rules };
    const t = typeInfo(info?.type ?? ev.source.type ?? "");
    const source: Rule[] = (t?.rules ?? []).map((r, i) => ({ ...r, id: `type:${t?.type}:${i}`, enabled: r.enabled !== false }));
    return { user, source };
  }

  private async deliver(ev: Envelope, sets: RuleSets): Promise<void> {
    const route = ev.route;
    if (!route || route.action === "drop") return;
    if (route.channels.includes("ws")) this.sockets.deliverEv(ev);
    if (ringing(route) && route.channels.some((c) => FALLBACK.includes(c))) await this.armFallback(ev.seq);
    if (route.action === "aggregate") await this.bucket(ev, sets);
  }

  // 安卓的 ack 只记在内存; 只有等着兜底推送时才落盘, 平时每条消息不必多写一次
  private ackedMem = 0;
  private waiting = false;

  async onAck(seq: number): Promise<void> {
    this.ackedMem = Math.max(this.ackedMem, seq);
    if (this.waiting) await this.storage.put(KEY_ACKED_SEQ, this.ackedMem);
  }

  private async armFallback(seq: number): Promise<void> {
    if (!hasFallback(this.env)) return;
    this.waiting = true;
    if (this.ackedMem) await this.storage.put(KEY_ACKED_SEQ, this.ackedMem);
    await this.storage.put(KEY_PENDING_SEQ, seq);
    await this.timers.set(TIMER_FALLBACK, Date.now() + FALLBACK_DELAY_MS, true);
  }

  // 安卓 1.5 秒内没有 ack 才走厂商推送, 多条合并成一次
  async runFallback(): Promise<void> {
    const pending = (await this.storage.get<number>(KEY_PENDING_SEQ)) ?? 0;
    const acked = Math.max(this.ackedMem, (await this.storage.get<number>(KEY_ACKED_SEQ)) ?? 0);
    this.waiting = false;
    await this.storage.delete(KEY_PENDING_SEQ);
    if (pending <= acked) return;
    const missed = this.store.since(acked, HISTORY_MAX_LIMIT).filter((e) => ringing(e.route));
    const last = missed[missed.length - 1];
    if (!last) return;
    const channels = new Set(missed.flatMap((e) => e.route?.channels ?? []));
    await sendFallback(this.env, {
      preview: titleOf(last),
      count: missed.length,
      pushToken: await this.storage.get<string>(KEY_PUSH_TOKEN),
      channels,
      wxUid: (await this.config.settings()).wxpusherUid,
    });
  }

  private aggKey(ev: Envelope): string {
    return `${ev.route?.rule ?? ""}|${ev.source.id}|${ev.subject ?? ""}`;
  }

  private async bucket(ev: Envelope, sets: RuleSets): Promise<void> {
    const key = this.aggKey(ev);
    const kv = KV_AGG_PREFIX + key;
    const cur = await this.storage.get<Bucket>(kv);
    if (cur) {
      cur.count += 1;
      await this.storage.put(kv, cur);
      return;
    }
    const rule = [...sets.user, ...sets.source].find((r) => r.id === ev.route?.rule);
    const b: Bucket = { count: 1, title: titleOf(ev), channels: rule?.channels?.length ? rule.channels : [...PUSH_CHANNELS] };
    if (ev.route?.rule) b.rule = ev.route.rule;
    if (ev.subject) b.subject = ev.subject;
    await this.storage.put(kv, b);
    await this.timers.set(TIMER_AGG_PREFIX + key, Date.now() + aggregateWindowSec(sets, ev.route?.rule) * 1000);
  }

  // 聚合窗口结束: 推一条 "N 条 xxx", 原始事件都已入库可追溯
  async flushBucket(key: string): Promise<void> {
    const kv = KV_AGG_PREFIX + key;
    const b = await this.storage.get<Bucket>(kv);
    await this.storage.delete(kv);
    if (!b) return;
    const settings = await this.config.settings();
    const quiet = settings.quiet && inWindow(settings.quiet, Date.now(), await this.config.tz());
    const route: RouteInfo = { action: quiet ? "silent" : "push", channels: quiet ? ["ws"] : b.channels, merged: b.count, reason: "聚合窗口结束" };
    if (b.rule) route.rule = b.rule;
    const draft = {
      id: "",
      seq: 0,
      ts: Date.now(),
      kind: "event",
      source: { id: SRC_SYSTEM, name: "聚合", icon: "layers" },
      priority: "happening",
      data: { title: b.count > 1 ? `${b.count} 条: ${b.title}` : b.title, severity: "normal" },
    } as Envelope;
    if (b.subject) draft.subject = b.subject;
    await this.ingest(draft, null, route);
  }
}
