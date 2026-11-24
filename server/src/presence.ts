import { LISTEN_TTL_MS, TYPING_TTL_MS, globMatch, type PresenceEntry, type PresenceFrame } from "@hx-aioa/protocol";
import type { ChatStore } from "./chat-store";
import type { RoomStore } from "./rooms";
import { type Sockets, attOf } from "./sockets";

// 名单里的一项: 谁, 叫什么, 到什么时候 (ms)
type Mark = { name: string; until: number };

/**
 * 群里 "谁在监听 / 谁在输入": 全在内存, 不写库; DO 休眠后清零, 下次拉取或输入时再出现。
 * 监听 = 用 CLI 长连 (role=chat) 的 Agent, 或 LISTEN_TTL_MS 内 HTTP 拉过本群消息的 Agent。
 * 只在名单变化 (或快到期需要续期) 时推一帧, 客户端按 until 自己过期, 服务端不设定时器。
 */
export class Presence {
  private readonly polls = new Map<string, Map<string, Mark>>();
  private readonly typing = new Map<string, Map<string, Mark>>();

  constructor(
    private readonly sockets: Sockets,
    private readonly chats: ChatStore,
    private readonly rooms: RoomStore,
  ) {}

  /** Agent 用 HTTP 拉了一次群消息。 */
  polled(channel: string, id: string, name: string, now = Date.now()): void {
    if (this.chats.chat(channel)?.hideListening) return;
    const map = this.slot(this.polls, channel);
    const old = map.get(id);
    map.set(id, { name, until: now + LISTEN_TTL_MS });
    // 新出现或剩下不到一半时间才推, 其余拉取不产生帧
    if (!old || old.until - now < LISTEN_TTL_MS / 2) this.push(channel, now);
  }

  /** 有人在输入; 同一个人 TTL 内重复上报不再推。 */
  typed(channel: string, id: string, name: string, now = Date.now()): void {
    if (this.chats.chat(channel)?.hideTyping) return;
    const map = this.slot(this.typing, channel);
    const old = map.get(id);
    map.set(id, { name, until: now + TYPING_TTL_MS });
    if (!old || old.until - now < TYPING_TTL_MS / 2) this.push(channel, now);
  }

  /** 发出消息就不算在输入了。 */
  sent(channel: string, id: string, now = Date.now()): void {
    if (this.typing.get(channel)?.delete(id)) this.push(channel, now);
  }

  /** CLI 长连接上或断开 (gone: 正在关的那条, 关闭回调里它还在连接列表中): 它能读的群都刷新一次。 */
  listenerChanged(patterns: string[], gone?: WebSocket, now = Date.now()): void {
    for (const m of this.chats.chats()) if (patterns.some((p) => globMatch(p, m.channel))) this.push(m.channel, now, gone);
  }

  /** 新连上的客户端: 有人在的群各补一帧。 */
  snapshot(send: (f: PresenceFrame) => void, now = Date.now()): void {
    const chans = new Set([...this.polls.keys(), ...this.typing.keys()]);
    for (const m of this.chats.chats()) if (this.sockets.listeners(m.channel).length) chans.add(m.channel);
    for (const ch of chans) {
      const f = this.frame(ch, now);
      if (f.listening.length || f.typing.length) send(f);
    }
  }

  frame(channel: string, now = Date.now(), gone?: WebSocket): PresenceFrame {
    const meta = this.chats.chat(channel);
    const live = (m?: Map<string, Mark>): PresenceEntry[] => {
      const out: PresenceEntry[] = [];
      for (const [id, v] of m ?? []) {
        if (v.until <= now) m?.delete(id);
        else out.push({ id, name: v.name, until: v.until });
      }
      return out;
    };
    const ws = this.sockets.listeners(channel).filter((s) => s !== gone).map((s) => {
      const a = attOf(s);
      return { id: a.keyId ?? a.device, name: a.name ?? a.device };
    });
    const polled = live(this.polls.get(channel)).filter((p) => !ws.some((w) => w.id === p.id));
    const listening = meta?.hideListening ? [] : [...dedupe(ws), ...polled];
    const typing = meta?.hideTyping ? [] : live(this.typing.get(channel));
    return { t: "presence", channel, listening, typing };
  }

  private push(channel: string, now: number, gone?: WebSocket): void {
    const members = new Set(this.rooms.members(channel).map((m) => m.member));
    this.sockets.toChannel(members, this.frame(channel, now, gone));
  }

  private slot(all: Map<string, Map<string, Mark>>, channel: string): Map<string, Mark> {
    let m = all.get(channel);
    if (!m) {
      m = new Map();
      all.set(channel, m);
    }
    return m;
  }
}

// 同一把 key 开了几条长连只算一个
function dedupe(list: PresenceEntry[]): PresenceEntry[] {
  return [...new Map(list.map((e) => [e.id, e])).values()];
}
