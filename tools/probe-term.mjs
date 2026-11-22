// 探针终端: 只有本机 AIOA_SHELL=1 启动时才会被加载。
// 用 python3 的 pty 开一个登录 shell, 字节经长连接原样中转; 15 分钟无输入自动断开, 最多 3 个会话。
import { spawn } from "node:child_process";
import os from "node:os";

const IDLE_MS = 15 * 60_000;
const MAX_SESSIONS = 3;
const CHUNK = 32 * 1024;
const CHECK_MS = 60_000;
const TERM_NAME = "xterm-256color";

// fd 0 输入, fd 1 输出, fd 3 收 "列 行\n" 调整窗口大小
const PTY_PY = `
import os, pty, sys, select, struct, fcntl, termios, signal
def size(fd, c, r):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", r, c, 0, 0))
pid, fd = pty.fork()
if pid == 0:
    sh = os.environ.get("SHELL") or "/bin/sh"
    os.execvp(sh, [sh, "-l"])
size(fd, int(sys.argv[1]), int(sys.argv[2]))
buf = b""
out = sys.stdout.buffer
try:
    while True:
        try:
            r, _, _ = select.select([0, fd, 3], [], [])
        except InterruptedError:
            continue
        if fd in r:
            try:
                d = os.read(fd, 65536)
            except OSError:
                break
            if not d:
                break
            out.write(d); out.flush()
        if 0 in r:
            d = os.read(0, 65536)
            if not d:
                break
            os.write(fd, d)
        if 3 in r:
            d = os.read(3, 1024)
            if not d:
                break
            buf += d
            while b"\\n" in buf:
                line, buf = buf.split(b"\\n", 1)
                c, rw = line.split()
                size(fd, int(c), int(rw))
                os.kill(pid, signal.SIGWINCH)
finally:
    try:
        os.kill(pid, signal.SIGHUP)
    except OSError:
        pass
`;

export function createTerminals(send) {
  const sessions = new Map();

  function close(sid, reason, notify = true) {
    const s = sessions.get(sid);
    if (!s) return;
    sessions.delete(sid);
    s.child.kill("SIGHUP");
    if (notify) send({ t: "term_close", sid, reason });
    console.log(`终端会话结束: ${sid} (${reason})`);
  }

  function open(f) {
    if (sessions.size >= MAX_SESSIONS) return send({ t: "term_close", sid: f.sid, reason: "会话已满" });
    const child = spawn("python3", ["-c", PTY_PY, String(f.cols), String(f.rows)], {
      cwd: os.homedir(),
      env: { ...process.env, TERM: TERM_NAME, AIOA_TOKEN: "" },
      stdio: ["pipe", "pipe", "ignore", "pipe"],
    });
    const s = { child, last: Date.now() };
    sessions.set(f.sid, s);
    child.stdout.on("data", (b) => {
      for (let i = 0; i < b.length; i += CHUNK) send({ t: "term", sid: f.sid, d: b.subarray(i, i + CHUNK).toString("base64") });
    });
    child.on("exit", () => close(f.sid, "shell 已退出"));
    child.on("error", (e) => close(f.sid, `启动失败: ${e.message}`));
    send({ t: "term_ready", sid: f.sid });
    console.log(`终端会话开始: ${f.sid}`);
  }

  setInterval(() => {
    const now = Date.now();
    for (const [sid, s] of sessions) if (now - s.last > IDLE_MS) close(sid, "15 分钟无操作, 已断开");
  }, CHECK_MS).unref();

  return {
    handle(f) {
      if (f.t === "term_open") return open(f);
      const s = sessions.get(f.sid);
      if (!s) return f.t === "term_close" ? undefined : send({ t: "term_close", sid: f.sid, reason: "会话不存在" });
      if (f.t === "term") {
        s.last = Date.now();
        s.child.stdin.write(Buffer.from(f.d, "base64"));
      } else if (f.t === "term_resize") {
        s.child.stdio[3].write(`${f.cols} ${f.rows}\n`);
      } else if (f.t === "term_close") {
        close(f.sid, f.reason ?? "对端关闭", false);
      }
    },
    // 断线时全部关掉: 重连后旧会话在服务端已失效
    closeAll() {
      for (const sid of [...sessions.keys()]) close(sid, "连接断开", false);
    },
  };
}
