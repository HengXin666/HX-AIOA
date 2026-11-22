// 终端页: xterm.js 负责显示与键盘, 字节经 Bridge (App) 收发, 全部 base64
const term = new Terminal({
  cursorBlink: true,
  fontSize: 13,
  fontFamily: "monospace",
  scrollback: 5000,
  theme: { background: "#0d1117", foreground: "#c9d1d9", cursor: "#58a6ff" },
});
const fit = new FitAddon.FitAddon();
term.loadAddon(fit);
term.open(document.getElementById("t"));
fit.fit();

const enc = new TextEncoder();
let ctrl = false;

function toB64(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

// 软键盘的 Ctrl: 下一个字母变成控制字符 (Ctrl+C = 0x03)
term.onData((d) => {
  if (ctrl && d.length === 1) {
    const c = d.toUpperCase().charCodeAt(0);
    if (c >= 64 && c <= 95) d = String.fromCharCode(c - 64);
    ctrl = false;
    Bridge.ctrlUsed();
  }
  Bridge.input(toB64(enc.encode(d)));
});
term.onBinary((d) => Bridge.input(btoa(d)));
term.onResize(({ cols, rows }) => Bridge.resize(cols, rows));
window.addEventListener("resize", () => fit.fit());

function w(s) {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  term.write(u);
}
function sys(text) {
  term.write("\r\n\x1b[90m" + text + "\x1b[0m\r\n");
}
function setCtrl(v) {
  ctrl = v;
}
function focusTerm() {
  term.focus();
}

Bridge.ready(term.cols, term.rows);
