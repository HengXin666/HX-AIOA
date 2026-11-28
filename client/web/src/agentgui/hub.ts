import { api } from "../core/auth";
import { Emitter } from "../core/emitter";
import { link } from "../core/link";
import { AID_LENGTH } from "../core/constants";
import { INBOX_FRESH_MS } from "./constants";
import { PATH_AGENT_GUI_INBOX } from "@hx-aioa/protocol";
import { updateRoutes } from "./pairs";
import type { Card, HubHost, InboxResult } from "./types";

export type HubSnap = { hosts: HubHost[]; cards: Card[]; answering: Record<string, true>; loaded: boolean; err: string; version: number };
const EMPTY: HubSnap = { hosts: [], cards: [], answering: {}, loaded: false, err: "", version: 0 };
export const cardKey = (c: { host: string; rid: string }): string => `${c.host}/${c.rid}`;

// 经 Hub 的那一小部分: 主机索引 (ag_hosts), 待审批卡 (ag_req / ag_unreq), 离线回来补拉 inbox。
// 帧走 App 已有的长连 (link), 不另建连接; inbox 只在有页面要用 (need) 时拉, 每次连上 (welcome) 最多一次
class AgentHub {
  readonly changed = new Emitter<void>();
  private snap: HubSnap = EMPTY;
  private owner = false;
  private needs = 0;
  // gen: 长连第几次连上 (welcome 计数); fetched: 拉过的那一代, -1 = 没拉过
  private gen = 0;
  private fetched = -1;
  private fetchedAt = 0;
  // 连接运行时加载后注入: 有直连就走直连 perm
  direct: ((card: Card, option: string | null, text: string) => boolean) | null = null;

  snapshot = (): HubSnap => this.snap;

  attach(owner: boolean): () => void {
    if (!owner) return () => undefined;
    this.owner = true;
    const off = link.frames.on((f) => {
      switch (f.t) {
        case "welcome":
          return this.onWelcome();
        case "ag_hosts":
          return Array.isArray(f.hosts) && this.setHosts(f.hosts as HubHost[]);
        case "ag_req":
          return f.card && typeof f.card === "object" ? this.putCard(f.card as Card) : undefined;
        case "ag_unreq":
          return this.dropCard(String(f.host ?? ""), String(f.sid ?? ""), String(f.rid ?? ""));
      }
    });
    return () => {
      off();
      this.owner = false;
      this.gen = 0;
      this.fetched = -1;
      this.snap = { ...EMPTY, version: this.snap.version + 1 };
    };
  }

  // 进 Agent GUI 或要显示收件箱计数的页面调用, 返回释放函数; 普通页面不调就不拉
  need(): () => void {
    this.needs++;
    this.maybeFetch();
    return () => {
      this.needs = Math.max(0, this.needs - 1);
    };
  }

  private onWelcome(): void {
    // 第一次连上前刚拉过 (打开页面时 HTTP 比长连快): 算这一代的, 不再拉
    if (this.gen === 0 && this.fetched === 0 && Date.now() - this.fetchedAt < INBOX_FRESH_MS) {
      this.gen = 1;
      this.fetched = 1;
      return;
    }
    this.gen++;
    this.maybeFetch();
  }

  private maybeFetch(): void {
    if (!this.owner || this.needs === 0 || this.fetched === this.gen) return;
    this.fetched = this.gen;
    this.fetchedAt = Date.now();
    void this.fetchInbox(this.gen);
  }

  private async fetchInbox(gen: number): Promise<void> {
    try {
      const r = await api<InboxResult>(PATH_AGENT_GUI_INBOX);
      const cards = (r?.cards ?? []).slice().sort((a, b) => a.at - b.at);
      this.set({ cards, loaded: true, err: "" });
      if (Array.isArray(r?.hosts)) this.setHosts(r.hosts);
    } catch (e) {
      // 失败: 这一代算没拉过, 下次 need / 重连再试
      if (this.fetched === gen) this.fetched = -1;
      this.set({ loaded: true, err: (e as Error).message });
    }
  }

  private setHosts(hosts: HubHost[]): void {
    for (const h of hosts) if (Array.isArray(h.routes)) updateRoutes(h.subject, h.routes);
    this.set({ hosts });
  }

  // dev 模拟探针用: 等同收到一条 ag_req
  mockCard(c: Card): void {
    this.putCard(c);
  }

  private putCard(c: Card): void {
    const k = cardKey(c);
    const cards = [...this.snap.cards.filter((x) => cardKey(x) !== k), c].sort((a, b) => a.at - b.at);
    this.set({ cards });
  }

  // 直连上答完 / 撤回时也调用, 让收件箱立刻消失
  dropCard(host: string, sid: string, rid: string): void {
    if (host) closeNotice(`ag-${host}-${rid}`);
    const cards = this.snap.cards.filter((c) => !(c.rid === rid && (c.host === host || (!host && c.sid === sid))));
    const k = `${host}/${rid}`;
    if (cards.length === this.snap.cards.length && !(k in this.snap.answering)) return;
    const answering = { ...this.snap.answering };
    delete answering[k];
    this.set({ cards, answering });
  }

  // 返回 false 表示两条路都没发出去
  answer(card: Card, option: string | null, text = ""): boolean {
    let ok = this.direct?.(card, option, text) ?? false;
    if (!ok) {
      const aid = `a_${crypto.randomUUID().replace(/-/g, "").slice(0, AID_LENGTH)}`;
      ok = link.write({ t: "ag_answer", aid, host: card.host, sid: card.sid, rid: card.rid, option, text });
    }
    if (ok) this.set({ answering: { ...this.snap.answering, [cardKey(card)]: true } });
    return ok;
  }

  private set(p: Partial<HubSnap>): void {
    this.snap = { ...this.snap, ...p, version: this.snap.version + 1 };
    this.changed.emit();
  }
}

// 其它端答了: 系统通知栏里那条也撤掉
function closeNotice(tag: string): void {
  if (!("serviceWorker" in navigator)) return;
  void navigator.serviceWorker
    .getRegistration()
    .then((reg) => reg?.getNotifications({ tag }))
    .then((list) => list?.forEach((n) => n.close()))
    .catch(() => undefined);
}

export const agHub = new AgentHub();
