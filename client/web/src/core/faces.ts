import { MEMBERS_DEFAULT_LIMIT, PATH_CHAT_MEMBERS, PATH_SENDERS, PATH_SETTINGS, QUERY_LIMIT, type RoomMembers, type SenderMeta } from "@hx-aioa/protocol";
import { api, authChanged, currentUser, fill } from "./auth";
import type { Message } from "./chats";
import { Emitter } from "./emitter";
import { link } from "./link";

const SETTING_AVATAR = "avatar";
const USER_PREFIX = "user:";

// 头像来源 (对照安卓 Senders.kt / Me.kt): 主人给发送者设的图 > 真人成员资料 > 字母头像;
// 自己: 账号上的 user.avatar, 没有用旧版设置里的 avatar (#142)
class Faces {
  readonly changed = new Emitter<void>();
  version = 0;
  private senders = new Map<string, SenderMeta>();
  private members = new Map<string, string>();
  private loadedRooms = new Set<string>();
  private legacy: string | null = null;
  private started = false;

  attach(): () => void {
    const offAuth = authChanged.on((u) => {
      if (!u) this.reset();
      else this.start();
    });
    const offFrames = link.frames.on((f) => {
      if (f.t === "chat_sync" && f.topic === "senders") void this.loadSenders();
      if (f.t === "settings" && f.settings && typeof f.settings === "object") this.setLegacy((f.settings as Record<string, unknown>)[SETTING_AVATAR]);
    });
    if (currentUser()) this.start();
    return () => {
      offAuth();
      offFrames();
    };
  }

  // 自己的头像 id
  me(): string | undefined {
    return currentUser()?.avatar ?? this.legacy ?? undefined;
  }

  sender(sid: string): SenderMeta | undefined {
    return this.senders.get(sid);
  }

  // 一条消息的发送者头像 id
  of(m: Message): string | undefined {
    const s = this.senders.get(m.source.id);
    if (s?.avatar) return s.avatar;
    const uid = m.by ?? (m.source.id.startsWith(USER_PREFIX) ? m.source.id.slice(USER_PREFIX.length) : undefined);
    if (!uid) return undefined;
    if (uid === currentUser()?.id) return this.me();
    return this.members.get(uid);
  }

  name(m: Message): string {
    return this.senders.get(m.source.id)?.alias ?? m.source.name;
  }

  // 多人群打开时取一页成员, 记下真人头像; 同一个群只取一次
  room(channel: string): void {
    if (this.loadedRooms.has(channel)) return;
    this.loadedRooms.add(channel);
    void api<RoomMembers>(`${fill(PATH_CHAT_MEMBERS, channel)}?${QUERY_LIMIT}=${MEMBERS_DEFAULT_LIMIT}`)
      .then((r) => {
        for (const m of r?.members ?? []) if (m.avatar) this.members.set(m.id, m.avatar);
        this.bump();
      })
      .catch(() => this.loadedRooms.delete(channel));
  }

  private start(): void {
    if (this.started) return;
    this.started = true;
    void this.loadSenders();
    if (currentUser()?.role === "owner") {
      void api<{ settings: Record<string, unknown> }>(PATH_SETTINGS)
        .then((r) => this.setLegacy(r?.settings?.[SETTING_AVATAR]))
        .catch(() => undefined);
    }
  }

  private async loadSenders(): Promise<void> {
    const r = await api<{ senders: SenderMeta[] }>(PATH_SENDERS).catch(() => null);
    if (!r) return;
    this.senders = new Map(r.senders.map((s) => [s.sid, s]));
    this.bump();
  }

  private setLegacy(v: unknown): void {
    const id = typeof v === "string" && v ? v : null;
    if (id === this.legacy) return;
    this.legacy = id;
    this.bump();
  }

  private bump(): void {
    this.version++;
    this.changed.emit();
  }

  private reset(): void {
    this.started = false;
    this.senders.clear();
    this.members.clear();
    this.loadedRooms.clear();
    this.legacy = null;
    this.bump();
  }
}

export const faces = new Faces();
