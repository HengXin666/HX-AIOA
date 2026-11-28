import { api } from "../core/auth";
import { Emitter } from "../core/emitter";
import { link } from "../core/link";
import { AID_LENGTH } from "../core/constants";
import { PATH_AGENT_GUI_INBOX } from "@hx-aioa/protocol";
import { updateRoutes } from "./pairs";
import type { Card, HubHost, InboxResult } from "./types";

export type HubSnap = { hosts: HubHost[]; cards: Card[]; answering: Record<string, true>; loaded: boolean; err: string; version: number };
const EMPTY: HubSnap = { hosts: [], cards: [], answering: {}, loaded: false, err: "", version: 0 };
export const cardKey = (c: { host: string; rid: string }): string => `${c.host}/${c.rid}`;

// 经 Hub 的那一小部分: 主机索引 (ag_hosts), 待审批卡 (ag_req / ag_unreq), 离线回来补拉 inbox
class AgentHub {
  readonly changed = new Emitter<void>();
  private snap: HubSnap = EMPTY;
  // 连接运行时加载后注入: 有直连就走直连 perm
  direct: ((card: Card, option: string | null, text: string) => boolean) | null = null;

  snapshot = (): HubSnap => this.snap;

  attach(owner: boolean): () => void {
    if (!owner) return () => undefined;
    const off = link.frames.on((f) => {
      switch (f.t) {
        case "welcome":
          return void this.fetchInbox();
        case "ag_hosts":
          return Array.isArray(f.hosts) && this.setHosts(f.hosts as HubHost[]);
        case "ag_req":
          return f.card && typeof f.card === "object" ? this.putCard(f.card as Card) : undefined;
        case "ag_unreq":
          return this.dropCard(String(f.host ?? ""), String(f.sid ?? ""), String(f.rid ?? ""));
      }
    });
    void this.fetchInbox();
    return () => {
      off();
      this.snap = { ...EMPTY, version: this.snap.version + 1 };
    };
  }

  async fetchInbox(): Promise<void> {
    try {
      const r = await api<InboxResult>(PATH_AGENT_GUI_INBOX);
      const cards = (r?.cards ?? []).slice().sort((a, b) => a.at - b.at);
      this.set({ cards, loaded: true, err: "" });
      if (Array.isArray(r?.hosts)) this.setHosts(r.hosts);
    } catch (e) {
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
