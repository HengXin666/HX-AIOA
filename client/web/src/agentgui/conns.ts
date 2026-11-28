import { Emitter } from "../core/emitter";
import { HostConn, type SockFactory } from "./conn";
import { agHub } from "./hub";
import { allPairs, pairsChanged } from "./pairs";

// 每台主机一个连接主人; 已配对的主机进工作台就开始连
const conns = new Map<string, HostConn>();
export const connsChanged = new Emitter<void>();
let started = false;
let version = 0;
const factories = new Map<string, { factory: SockFactory; skipHello: boolean }>();

export const connsVersion = (): number => version;

export function conn(host: string): HostConn {
  let c = conns.get(host);
  if (!c) {
    const f = factories.get(host);
    c = new HostConn(host, f?.factory, f?.skipHello);
    conns.set(host, c);
    c.changed.on(() => {
      version++;
      connsChanged.emit();
    });
    if (started) c.start();
  }
  return c;
}

export const knownConn = (host: string): HostConn | undefined => conns.get(host);

// dev 模拟探针用: 指定某个主机的连接方式 (不经 /hello)
export function setFactory(host: string, factory: SockFactory): void {
  factories.set(host, { factory, skipHello: true });
}

function sync(): void {
  for (const p of allPairs()) conn(p.host);
}

export function startConns(): () => void {
  if (started) return () => undefined;
  started = true;
  sync();
  for (const c of conns.values()) c.start();
  const off = pairsChanged.on(() => {
    sync();
    for (const c of conns.values()) c.kick();
  });
  // 审批模式的答复: 有直连走直连 perm, 没有返回 false 让 Hub 走 ag_answer
  agHub.direct = (card, option, text) => {
    const c = conns.get(card.host);
    if (c?.snapshot().state !== "ready") return false;
    return c.perm(card.sid, card.rid, option, text);
  };
  return () => {
    off();
    started = false;
    agHub.direct = null;
    for (const c of conns.values()) c.stop();
  };
}
