import { LOCK_TAB_PREFIX } from "./constants";
import { LinkHub } from "./link-hub";
import type { ToHub } from "./link-proto";

// SharedWorker: 同一个浏览器所有标签共用这一条连接; 标签关掉时它持有的锁释放, 这里据此移除
const hub = new LinkHub();
const scope = self as unknown as { onconnect: ((e: MessageEvent) => void) | null };

scope.onconnect = (e) => {
  const port = e.ports[0];
  if (!port) return;
  let id: string | null = null;
  port.onmessage = (ev: MessageEvent<ToHub>) => {
    const m = ev.data;
    if (!id && m.op === "hello") {
      const me = m.id;
      id = me;
      hub.add(me, (x) => port.postMessage(x));
      void navigator.locks?.request(LOCK_TAB_PREFIX + me, () => hub.remove(me));
    }
    if (id) hub.receive(id, m);
  };
  port.start();
};
