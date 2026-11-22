import { TERM_MAX_SESSIONS, TERM_TICKET_MS, type TermFrame, type TermOpenFrame } from "@hx-aioa/protocol";
import { hmac, randomId, safeEqual } from "./auth";
import { isProbe } from "./metrics";
import { type Attachment, attOf, sendFrame } from "./sockets";

const TICKET_SEP = ".";
const NONCE_PREFIX = "n";
const ERR_TICKET = "票据无效或已过期, 请重新输入密码";
const ERR_NO_HOST = "主机不在线或没有开启终端";
const ERR_BUSY = "这台主机的终端会话已满";
const ERR_NO_SESSION = "会话不存在";
const CLOSED_PEER = "对端已断开";

type Audit = (text: string, loud: boolean) => Promise<void>;

const termsOf = (ws: WebSocket) => attOf(ws).terms ?? [];

function setTerms(ws: WebSocket, terms: string[]): void {
  ws.serializeAttachment({ ...attOf(ws), terms } satisfies Attachment);
}

// 终端中转: 会话只记在两端连接的 attachment 里 (sid 列表), 字节原样转发, 不写库
export class Terminals {
  constructor(
    private readonly all: () => WebSocket[],
    private readonly secret: () => string,
    private readonly audit: Audit,
  ) {}

  // 票据 = 主体.过期时间.随机数.签名, 无状态, 60 秒内有效
  async ticket(subject: string, now = Date.now()): Promise<{ ticket: string; exp: number }> {
    const exp = now + TERM_TICKET_MS;
    const body = [subject, exp, randomId(NONCE_PREFIX)].join(TICKET_SEP);
    return { ticket: `${body}${TICKET_SEP}${await hmac(this.secret(), body)}`, exp };
  }

  async verify(ticket: string, subject: string, now = Date.now()): Promise<boolean> {
    const parts = ticket.split(TICKET_SEP);
    if (parts.length !== 4 || parts[0] !== subject || Number(parts[1]) < now) return false;
    const body = parts.slice(0, 3).join(TICKET_SEP);
    return safeEqual(parts[3]!, await hmac(this.secret(), body));
  }

  // 探针连接: 认 offer 了该主体, key 带 probe:shell, 且探针自己声明开了终端
  probeFor(subject: string): WebSocket | undefined {
    return this.all().find((ws) => {
      const a = attOf(ws);
      return isProbe(a) && a.shell === true && (a.offer ?? []).includes(subject) && a.host?.info.shell === true;
    });
  }

  private peerOf(ws: WebSocket, sid: string): WebSocket | undefined {
    return this.all().find((o) => o !== ws && termsOf(o).includes(sid));
  }

  async handle(ws: WebSocket, att: Attachment, f: TermFrame): Promise<void> {
    if (f.t === "term_open") return this.open(ws, att, f);
    if (!termsOf(ws).includes(f.sid)) return void sendFrame(ws, { t: "term_close", sid: f.sid, reason: ERR_NO_SESSION });
    const peer = this.peerOf(ws, f.sid);
    if (!peer) {
      this.drop(ws, f.sid);
      if (f.t !== "term_close") sendFrame(ws, { t: "term_close", sid: f.sid, reason: CLOSED_PEER });
      return;
    }
    // 探针只能回 ready / 数据 / 关闭; 客户端只能发数据 / 调大小 / 关闭
    const probe = isProbe(att);
    if ((f.t === "term_ready" && !probe) || (f.t === "term_resize" && probe)) return;
    sendFrame(peer, f);
    if (f.t === "term_close") {
      this.drop(ws, f.sid);
      this.drop(peer, f.sid);
      const subject = probe ? att.offer?.[0] : attOf(peer).offer?.[0];
      await this.audit(`终端已关闭: ${subject ?? "?"}${f.reason ? ` (${f.reason})` : ""}`, false);
    }
  }

  private async open(ws: WebSocket, att: Attachment, f: TermOpenFrame): Promise<void> {
    const fail = (reason: string) => void sendFrame(ws, { t: "term_close", sid: f.sid, reason });
    if (att.role !== "client" || !f.subject || !f.ticket) return fail(ERR_TICKET);
    if (!(await this.verify(f.ticket, f.subject))) return fail(ERR_TICKET);
    const probe = this.probeFor(f.subject);
    if (!probe) return fail(ERR_NO_HOST);
    if (termsOf(probe).length >= TERM_MAX_SESSIONS) return fail(ERR_BUSY);
    if (this.all().some((o) => termsOf(o).includes(f.sid))) return fail(ERR_BUSY);
    setTerms(ws, [...termsOf(ws), f.sid]);
    setTerms(probe, [...termsOf(probe), f.sid]);
    sendFrame(probe, { t: "term_open", sid: f.sid, cols: f.cols, rows: f.rows });
    await this.audit(`终端已打开: ${f.subject} (设备 ${att.device})`, true);
  }

  private drop(ws: WebSocket, sid: string): void {
    const left = termsOf(ws).filter((s) => s !== sid);
    if (left.length !== termsOf(ws).length) setTerms(ws, left);
  }

  // 一端断开: 通知另一端并清掉会话
  release(ws: WebSocket, att: Attachment): void {
    for (const sid of att.terms ?? []) {
      const peer = this.peerOf(ws, sid);
      if (!peer) continue;
      sendFrame(peer, { t: "term_close", sid, reason: CLOSED_PEER });
      this.drop(peer, sid);
    }
  }
}
