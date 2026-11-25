import { attachFile } from "./files/api";
import { FileStore } from "./files/store";
import { mailIn } from "./mail/ingest";
import { MailStore } from "./mail/store";
import { Market } from "./plugins/market";
import { PluginStore } from "./plugins/store";
import { TodoStore } from "./plugins/todos";
import { TranslateStore } from "./translate/store";
import { GhService, syncTodoIssues } from "./gh/service";
import { DurableObject } from "cloudflare:workers";
import {
  ACCESS_PREFIX,
  ANDROID_DEVICE_PREFIX,
  PING_TEXT,
  PONG_TEXT,
  PROBE_DEVICE_PREFIX,
  SOURCE_TYPE_USER,
  USER_SOURCE_PREFIX,
  PROTOCOL_VERSION,
  QUERY_DEVICE,
  QUERY_ROLE,
  QUERY_SINCE,
  STREAM_PATH,
  STREAM_ROLES,
  parseClientFrame,
  parseStreamFrame,
  type ClientFrame,
  type GithubSyncResult,
  type MailInput,
  type StreamClientFrame,
  type StreamRole,
  type RouteInfo,
  type UserPublic,
} from "@hx-aioa/protocol";
import { handleAccounts } from "./accounts/api";
import { HEADER_INTERNAL_USER, KICK_CODE, KICK_REASON, SESSION_TAG_PREFIX } from "./accounts/constants";
import { Accounts, type Session } from "./accounts/service";
import { verifyPassword } from "./accounts/crypto";
import { messageInput } from "./api-events";
import { cfUsage } from "./api-cf";
import { credentialOf } from "./auth";
import { AgentService } from "./agents";
import { handleHttp, principalOf } from "./api";
import { Config } from "./config";
import {
  ABNORMAL_CLOSE,
  CODE_BAD_REQUEST,
  CODE_FORBIDDEN,
  CODE_UNAUTHORIZED,
  ERR_BAD_FRAME,
  ERR_FORBIDDEN,
  ERR_UNAUTHORIZED,
  HISTORY_DEFAULT_LIMIT,
  HISTORY_MAX_LIMIT,
  KEY_PUSH_TOKEN,
  NORMAL_CLOSE,
  NO_STATUS_CLOSE,
  OVERVIEW_SCAN,
  OWNER_ID,
  PROTO_LEGACY,
  PROTO_V1,
  TIMER_AGG_PREFIX,
  TIMER_FALLBACK,
  TIMER_PROMPT_PREFIX,
  UNKNOWN_DEVICE,
  OWNER_NAME,
} from "./constants";
import { type Core, type Principal, allowed } from "./core";
import { joinPage } from "./join-page";
import { authorOf } from "./room-access";
import type { Env } from "./env";
import { GithubService } from "./github/service";
import { buildOverview } from "./group";
import { chatInput } from "./chat";
import { ChatStore } from "./chat-store";
import { ApiFail, fail } from "./http";
import { toMsgFrame } from "./legacy";
import { MetricRouter, isProbe } from "./metrics";
import { Pipeline } from "./pipeline";
import { Registry } from "./registry";
import { type Attachment, Sockets, attOf, sendFrame } from "./sockets";
import { EventStore, groupOf } from "./store";
import { RoomStore } from "./rooms";
import { joinRoom } from "./api-rooms";
import { chatBacklog, chatConnected, mayListen, typingFrom } from "./api-presence";
import { Presence } from "./presence";
import { memberKey } from "./member";
import { Spaces } from "./spaces";
import { TaskStore } from "./taskstore";
import { Terminals } from "./terminal";
import { Timers } from "./timers";
const TERM_SOURCE = "终端";
const CF_SOURCE = "CF 额度";
const KEY_CF_ALERT = "cf_alert_day";
const CF_ALERT_RATIO = 0.8;
const PCT = 100;
const ROUTE_SELF: RouteInfo = { action: "silent", channels: ["ws"], reason: "本人发送" };
const ROUTE_ROOM: RouteInfo = { action: "push", channels: ["ws"], reason: "群聊" };

// 单实例消息中枢 (多账号落地后即每用户一个), 只用休眠 API, 空闲时不计运行时长
export class Hub extends DurableObject<Env> {
  private readonly core: Core;
  private readonly timers: Timers;
  private accounts?: Accounts;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    const every = () => this.ctx.getWebSockets();
    // 子号的连接只收群消息, 探针, 指标, 终端都看不到
    const all = () => every().filter((ws) => !attOf(ws).member);
    const store = new EventStore(sql, (fn) => ctx.storage.transactionSync(fn));
    const config = new Config(ctx.storage);
    const metrics = new MetricRouter(all, sql);
    const rooms = new RoomStore(sql);
    const sockets = new Sockets(every, (ev) => {
      const grp = groupOf(ev);
      return new Set(grp ? rooms.members(grp).map((m) => m.member) : []);
    });
    this.timers = new Timers(ctx.storage);
    const files = new FileStore(sql, env.FILES);
    const pipeline = new Pipeline(env, ctx.storage, store, config, metrics, sockets, this.timers, files);
    const spaces = new Spaces(ctx.storage);
    const agents = new AgentService(new TaskStore(sql), sockets, pipeline, this.timers, spaces);
    const registry = new Registry(sql);
    const github = new GithubService(env, sql, ctx.storage, registry);
    const terms = new Terminals(all, () => env.TOKEN_SECRET || env.AUTH_TOKEN, (text, loud) => this.termAudit(text, loud));
    const checkPassword = async (id: string, pw: string) => verifyPassword(pw, this.acct().dir.passOf(id) ?? "");
    const users = {
      get: (id: string) => this.acct().dir.user(id),
      find: (ref: string) => this.acct().dir.find(ref),
      ownerId: () => this.acct().dir.owner()?.id ?? OWNER_ID,
    };
    const chats = new ChatStore(sql);
    const presence = new Presence(sockets, chats, rooms);
    this.core = { env, store, presence, registry, config, pipeline, agents, metrics, sockets, spaces, github, chats, rooms, files, plugins: new PluginStore(sql), mail: new MailStore(sql), todos: new TodoStore(sql), tr: new TranslateStore(sql), gh: new GhService(env, sql), market: new Market(env.PLUGIN_MARKET), users, terms, checkPassword, dbSize: () => sql.databaseSize };
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING_TEXT, PONG_TEXT));
  }

  // 长连接上的人: 主人或子号; 子号查不到账号时当成没有任何群的成员
  private principalOf(att: Attachment): Principal | null {
    if (!att.member || !att.uid) return { owner: true };
    const user = this.core.users.get(att.uid);
    if (!user) return null;
    return { owner: false, key: memberKey(user), member: { user, session: "" } };
  }

  // RPC (Worker): R2 写完后回报实际大小; 登记已被删掉时返回 false, Worker 会删掉刚写的对象
  async fileDone(id: string, size: number): Promise<boolean> {
    return this.core.files.done(id, size);
  }

  // RPC (每天的清理 cron): 删掉传了没发出去的文件
  async fileSweep(): Promise<number> {
    return this.core.files.sweep();
  }

  // RPC (Worker 的 email 入口): CF 邮件路由收到的信, 已在 Worker 里解析好
  async mailIn(input: MailInput): Promise<string> {
    return (await mailIn(this.core, input, "cf")).id;
  }

  // RPC (每天的清理 cron): 删掉消息已不在的邮件索引
  async mailPrune(): Promise<number> {
    return this.core.mail.prune();
  }

  // RPC (cron 每 30 分钟): 任一额度用到 80% 时提醒一次, 每天最多一条
  async cfCheck(): Promise<void> {
    const u = await cfUsage(this.env);
    const hot = (u.items ?? []).filter((i) => i.used >= i.limit * CF_ALERT_RATIO);
    if (!hot.length || !u.day || (await this.ctx.storage.get<string>(KEY_CF_ALERT)) === u.day) return;
    await this.ctx.storage.put(KEY_CF_ALERT, u.day);
    const text = `今天 (UTC) 的 CF 免费额度已用超过 80%: ${hot.map((i) => `${i.label} ${Math.round((i.used / i.limit) * PCT)}%`).join(", ")}`;
    const input = messageInput({ text });
    if (typeof input !== "string") await this.core.pipeline.fromInput(input, { source: { id: CF_SOURCE, name: CF_SOURCE }, sourceInfo: null });
  }

  // 终端开关记一条消息到 "终端" 群: 打开时按规则提醒, 关闭时静默
  private async termAudit(text: string, loud: boolean): Promise<void> {
    const input = messageInput({ text });
    if (typeof input === "string") return;
    const origin = { source: { id: TERM_SOURCE, name: TERM_SOURCE }, sourceInfo: null };
    await this.core.pipeline.fromInput(input, origin, loud ? undefined : { action: "silent", channels: ["ws"], reason: "终端关闭" });
  }

  // 主 Hub 才有账号目录; 子号 DO 只收主 Hub 转发来的请求
  private acct(): Accounts {
    if (!this.accounts) {
      this.accounts = new Accounts(this.ctx.storage.sql, this.env, (u, ids) => this.kickUser(u, ids));
      this.accounts.joinRoom = (uid, code) => joinRoom(this.core, uid, code);
      this.accounts.onDelete = (uid) => this.core.rooms.forget(uid);
    }
    return this.accounts;
  }

  // 子号现在也连主 Hub; 旧的子号 DO 里可能还挂着老连接, 一并踢
  private async kickUser(user: UserPublic, ids: string[]): Promise<void> {
    await this.kick(ids);
    if (user.role !== "owner") await this.acct().userHub(user).kick(ids);
  }

  // RPC: 断开这些会话的长连接
  async kick(ids: string[]): Promise<void> {
    for (const id of ids) {
      for (const ws of this.ctx.getWebSockets(SESSION_TAG_PREFIX + id)) {
        try {
          sendFrame(ws, { t: "err", code: CODE_UNAUTHORIZED, text: KICK_REASON });
          ws.close(KICK_CODE, KICK_REASON);
        } catch {
          // 已关闭
        }
      }
    }
  }

  // RPC: 删号时清空该用户 DO 的全部数据
  async wipe(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(KICK_CODE, KICK_REASON);
      } catch {
        // 已关闭
      }
    }
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  private async preAuth(req: Request, url: URL): Promise<Response | Principal | undefined> {
    const internal = req.headers.get(HEADER_INTERNAL_USER);
    if (internal) {
      const s = JSON.parse(decodeURIComponent(internal)) as Session;
      return { owner: true, user: s.user, session: s.session };
    }
    const acct = await handleAccounts(this.acct(), req, url, this.env.AUTH_TOKEN);
    if (acct) return acct;
    const cred = credentialOf(req, url);
    if (!cred.startsWith(ACCESS_PREFIX)) return undefined;
    const s = await this.acct().resolve(cred);
    if (!s) return fail(401, ERR_UNAUTHORIZED, CODE_UNAUTHORIZED);
    // 子号与主人共用这一个库, 只能进自己所在的多人群
    if (s.user.role !== "owner") return { owner: false, key: memberKey(s.user), member: { user: s.user, session: s.session } };
    return { owner: true, user: s.user, session: s.session };
  }

  override async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const page = await joinPage(this.core, req, url);
    if (page) return page;
    let pre: Principal | undefined;
    try {
      const r = await this.preAuth(req, url);
      if (r instanceof Response) return r;
      pre = r;
    } catch (e) {
      if (e instanceof ApiFail) return fail(e.status, e.message, e.code);
      throw e;
    }
    if (req.headers.get("Upgrade") !== "websocket") return handleHttp(this.core, req, pre);
    const who = pre ?? (await principalOf(this.core, req, url));
    if (!who) return fail(401, ERR_UNAUTHORIZED, CODE_UNAUTHORIZED);
    const v1 = url.pathname === STREAM_PATH;
    const device = url.searchParams.get(QUERY_DEVICE) || UNKNOWN_DEVICE;
    const roleRaw = url.searchParams.get(QUERY_ROLE) ?? (device.startsWith(PROBE_DEVICE_PREFIX) ? "probe" : "client");
    const role = (STREAM_ROLES as readonly string[]).includes(roleRaw) ? (roleRaw as StreamRole) : null;
    if (!role || !this.mayConnect(who, role, device)) return fail(403, ERR_FORBIDDEN, CODE_FORBIDDEN);

    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    const session = who.owner ? who.session : who.member?.session;
    this.ctx.acceptWebSocket(server, session ? [device, SESSION_TAG_PREFIX + session] : [device]);
    const att: Attachment = { device, proto: v1 ? PROTO_V1 : PROTO_LEGACY, role };
    if (!who.owner) att.keyId = who.key.id;
    if (role === "probe") att.shell = allowed(who, "probe:shell");
    const uid = role === "client" ? authorOf(this.core, who) : undefined;
    if (uid) att.uid = uid;
    if (!who.owner && who.member) att.member = true;
    server.serializeAttachment(att);

    const head = this.core.store.head();
    const user = who.owner ? who.user : who.member?.user;
    const listen = role === "chat" ? chatConnected(this.core, server, att, who) : undefined;
    const me = { ...(user ? { user, session } : {}), ...(uid ? { uid } : {}), ...(listen ? { me: listen } : {}) };
    const since = Number(url.searchParams.get(QUERY_SINCE) ?? Number.NaN);
    const floor = this.core.store.floor();
    // 断线期间有墓碑被清理: 让客户端丢掉 floor 之前的缓存, 补拉改为最近一批
    const resync = Number.isFinite(since) && since > 0 && since < floor;
    if (v1) sendFrame(server, { t: "welcome", head, v: PROTOCOL_VERSION, now: Date.now(), role, ...me, ...(resync ? { resync, floor } : {}) });
    else sendFrame(server, { t: "welcome", head });
    if (listen) {
      chatBacklog(this.core, server, who, since);
      this.core.presence.listenerChanged(listen.reads);
    }
    if (role !== "client") return new Response(null, { status: 101, webSocket: client });
    this.core.presence.snapshot((f) => sendFrame(server, f));
    if (att.member) {
      if (uid && Number.isFinite(since)) {
        const grps = this.core.rooms.roomsOf(uid).map((m) => m.grp);
        const evs = resync ? this.core.store.recentIn(grps, HISTORY_MAX_LIMIT) : this.core.store.sinceIn(grps, since, HISTORY_MAX_LIMIT);
        for (const ev of evs) sendFrame(server, { t: "ev", ev });
      }
      return new Response(null, { status: 101, webSocket: client });
    }
    sendFrame(server, this.core.metrics.probes());
    // 装过的主机 (含离线) 一连上就给, 总览不必等到有在线探针才看得到它们
    sendFrame(server, this.core.metrics.hostsFrame());
    if (v1) sendFrame(server, { t: "agents", agents: this.core.agents.statuses() });
    if (v1) for (const space of await this.core.spaces.list()) sendFrame(server, { t: "space_update", id: space.id, space });
    if (Number.isFinite(since)) {
      const evs = resync ? this.core.store.recent(HISTORY_MAX_LIMIT) : this.core.store.since(since, HISTORY_MAX_LIMIT);
      for (const ev of evs) sendFrame(server, v1 ? { t: "ev", ev } : toMsgFrame(ev));
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  // Worker 的 scheduled cron 通过 RPC 调用, 没配 token 时什么也不做
  async githubSync(): Promise<GithubSyncResult | null> {
    return this.core.github.sync();
  }

  async todoIssueSync(): Promise<number> {
    return syncTodoIssues(this.core);
  }

  private mayConnect(who: Principal, role: StreamRole, device: string): boolean {
    if (role === "client") return who.owner || !!who.member;
    if (role === "agent") return allowed(who, "agent");
    if (role === "chat") return mayListen(who);
    if (!allowed(who, "probe") || !device.startsWith(PROBE_DEVICE_PREFIX)) return false;
    return who.owner || !who.key.subject || device === `${PROBE_DEVICE_PREFIX}-${who.key.subject}`;
  }

  override async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    if (typeof data !== "string") return void this.err(ws, CODE_BAD_REQUEST, ERR_BAD_FRAME);
    const att = attOf(ws);
    try {
      if (att.proto === PROTO_V1) {
        let obj: unknown;
        try {
          obj = JSON.parse(data);
        } catch {
          return void this.err(ws, CODE_BAD_REQUEST, ERR_BAD_FRAME);
        }
        const f = typeof obj === "object" && obj !== null ? parseStreamFrame(obj as Record<string, unknown>) : null;
        if (typeof f === "string") return void this.err(ws, CODE_BAD_REQUEST, f, (obj as { aid?: string }).aid);
        if (f) return await this.handleStream(ws, att, f);
      }
      const frame = parseClientFrame(data);
      if (!frame) return void this.err(ws, CODE_BAD_REQUEST, ERR_BAD_FRAME);
      await this.handleLegacy(ws, att, frame);
    } catch (e) {
      const aid = (() => {
        try {
          return (JSON.parse(data) as { aid?: string }).aid;
        } catch {
          return undefined;
        }
      })();
      if (e instanceof ApiFail) this.err(ws, e.code, e.message, aid);
      else this.err(ws, "internal", String(e), aid);
    }
  }

  private async handleStream(ws: WebSocket, att: Attachment, f: StreamClientFrame): Promise<void> {
    const agents = this.core.agents;
    const isAgent = att.role === "agent";
    if (att.member) return this.err(ws, CODE_FORBIDDEN, ERR_FORBIDDEN);
    if ((f.t === "task" || f.t === "agent_hello" || f.t === "act_ack") !== isAgent) return this.err(ws, CODE_FORBIDDEN, ERR_FORBIDDEN);
    switch (f.t) {
      case "act": {
        const { t: _t, ...input } = f;
        const r = await agents.act(input, OWNER_ID);
        sendFrame(ws, { t: "act_ok", ...r });
        return;
      }
      case "overview": {
        const overview = buildOverview(this.core.store.recent(OVERVIEW_SCAN), agents.list(null, HISTORY_DEFAULT_LIMIT), Date.now());
        sendFrame(ws, { t: "overview", overview });
        return;
      }
      case "task": {
        const { t: _t, ...op } = f;
        const fallback = att.agents?.length === 1 ? att.agents[0] : undefined;
        const task = await agents.op(op, fallback ? { keyId: att.keyId ?? null, agent: fallback } : { keyId: att.keyId ?? null });
        sendFrame(ws, { t: "task", task });
        return;
      }
      case "agent_hello":
        agents.hello(ws, f.agent);
        return;
      case "act_ack":
        agents.ack(f.aid, { keyId: att.keyId ?? null });
        return;
    }
  }

  private async handleLegacy(ws: WebSocket, att: Attachment, frame: ClientFrame): Promise<void> {
    const metrics = this.core.metrics;
    if (att.member && frame.t !== "send" && frame.t !== "typing") return;
    if (att.role === "chat" && frame.t !== "typing") return;
    switch (frame.t) {
      case "watch":
        ws.serializeAttachment({ ...att, watch: frame.subjects } satisfies Attachment);
        metrics.primeWatcher(ws, frame.subjects.filter((s) => !(att.watch ?? []).includes(s)));
        if (frame.subjects.length && !(att.watch ?? []).length) sendFrame(ws, metrics.hostsFrame());
        metrics.rebalance();
        return;
      case "offer":
        if (!isProbe(att)) return;
        ws.serializeAttachment({ ...att, offer: frame.subjects, demand: [] } satisfies Attachment);
        metrics.rebalance();
        return;
      case "metric":
        if (isProbe(att) && (att.offer ?? []).includes(frame.subject)) metrics.relay(frame, false);
        return;
      case "host":
        if (isProbe(att) && (att.offer ?? []).includes(frame.subject)) metrics.host(ws, att, frame);
        return;
      case "term_open":
      case "term_ready":
      case "term":
      case "term_resize":
      case "term_close":
        return this.core.terms.handle(ws, att, frame);
      case "send": {
        if (att.role !== "client") return;
        const input = chatInput(this.core.store, frame);
        if (typeof input === "string") return this.err(ws, CODE_BAD_REQUEST, input);
        const sender = frame.file ? this.principalOf(att) : null;
        if (frame.file && !sender) return this.err(ws, CODE_FORBIDDEN, ERR_FORBIDDEN);
        const file = sender ? attachFile(this.core, sender, frame.file, input.channel) : undefined;
        if (typeof file === "string") return this.err(ws, CODE_BAD_REQUEST, file);
        if (file && input.kind === "event") input.data = { ...input.data, file };
        const grp = input.channel ?? "";
        if (att.member && !(att.uid && this.core.rooms.member(grp, att.uid))) return this.err(ws, CODE_FORBIDDEN, ERR_FORBIDDEN);
        // 多人群照常提醒其他人 (发送者自己的设备按 by 认出是自己发的); 只有自己的群不响铃, 也不触发兜底推送
        const shared = !!grp && this.core.rooms.shared(grp);
        const route = shared ? ROUTE_ROOM : ROUTE_SELF;
        // 来源是人 (账号), 不是设备: 同一个人多台设备同一个来源, 名字取账号昵称
        const user = att.uid ? this.core.users.get(att.uid) : undefined;
        const source = att.uid
          ? { id: USER_SOURCE_PREFIX + att.uid, name: user?.display || user?.name || OWNER_NAME, type: SOURCE_TYPE_USER }
          : { id: att.device, name: OWNER_NAME, type: SOURCE_TYPE_USER };
        const ev = await this.core.pipeline.fromInput(input, { source, cid: frame.cid, ...(att.uid ? { by: att.uid } : {}) }, route);
        sendFrame(ws, { t: "sent", cid: frame.cid, seq: ev.seq, ts: ev.ts });
        if (grp) this.core.presence.sent(grp, source.id);
        return;
      }
      case "typing":
        return typingFrom(this.core, att, frame.channel);
      case "ack":
        if (att.device.startsWith(ANDROID_DEVICE_PREFIX)) await this.core.pipeline.onAck(frame.seq);
        return;
      case "reg":
        if (att.role === "client") await this.ctx.storage.put(KEY_PUSH_TOKEN, frame.pushToken);
        return;
    }
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    this.release(ws);
    // 1005 / 1006 是保留码, 不能用于主动关闭
    try {
      ws.close(code === ABNORMAL_CLOSE || code === NO_STATUS_CLOSE ? NORMAL_CLOSE : code, reason);
    } catch {
      // 已关闭
    }
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    this.release(ws);
  }

  private release(ws: WebSocket): void {
    const att = attOf(ws);
    ws.serializeAttachment({ ...att, watch: [], offer: [], agents: [], host: undefined, terms: [] } satisfies Attachment);
    this.core.terms.release(ws, att);
    if (att.host) this.core.metrics.offline(att.host);
    this.core.metrics.rebalance();
    if (att.host) this.core.metrics.broadcastHosts();
    if (att.role === "agent") this.core.agents.broadcastAgents();
    if (att.role === "chat") this.core.presence.listenerChanged(att.reads ?? [], ws);
  }

  override async alarm(): Promise<void> {
    for (const name of await this.timers.takeDue(Date.now())) {
      try {
        if (name === TIMER_FALLBACK) await this.core.pipeline.runFallback();
        else if (name.startsWith(TIMER_AGG_PREFIX)) await this.core.pipeline.flushBucket(name.slice(TIMER_AGG_PREFIX.length));
        else if (name.startsWith(TIMER_PROMPT_PREFIX)) await this.core.agents.expire(name.slice(TIMER_PROMPT_PREFIX.length));
      } catch (e) {
        console.error("定时任务失败:", name, e);
      }
    }
  }

  private err(ws: WebSocket, code: string, text: string, aid?: string): void {
    sendFrame(ws, aid ? { t: "err", code, text, aid } : { t: "err", code, text });
  }
}
