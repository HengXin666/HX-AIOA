// 工作台快捷键: 照搬 t3code 的 "按键 -> 命令 + when 条件" 模型与默认键位 (只取本端有的命令)
export type Command =
  | "commandPalette.toggle"
  | "sidebar.toggle"
  | "rightPanel.toggle"
  | "diff.toggle"
  | "chat.new"
  | "chat.find"
  | "filePicker.toggle"
  | "thread.previous"
  | "thread.next"
  | "thread.pin"
  | "thread.settle"
  | "thread.copyReference"
  | "modelPicker.toggle"
  | "composer.mode"
  | "composer.stash"
  | "turn.stop"
  | "shortcuts.open"
  | `thread.jump.${number}`;

export type When = "composerFocus" | "turnRunning" | "inSession" | "editableFocus";
export type Rule = { key: string; command: Command; when?: string };

const JUMP = Array.from({ length: 9 }, (_, i): Rule => ({ key: `mod+${i + 1}`, command: `thread.jump.${i + 1}` }));

export const DEFAULT_KEYBINDINGS: Rule[] = [
  { key: "mod+k", command: "commandPalette.toggle" },
  { key: "mod+b", command: "sidebar.toggle" },
  { key: "mod+alt+b", command: "rightPanel.toggle", when: "inSession" },
  { key: "mod+d", command: "diff.toggle", when: "inSession" },
  { key: "mod+n", command: "chat.new" },
  { key: "mod+shift+o", command: "chat.new" },
  { key: "mod+f", command: "chat.find" },
  { key: "mod+p", command: "filePicker.toggle", when: "inSession" },
  { key: "mod+shift+[", command: "thread.previous" },
  { key: "mod+shift+]", command: "thread.next" },
  { key: "mod+shift+p", command: "thread.pin", when: "inSession" },
  { key: "mod+shift+s", command: "thread.settle", when: "inSession" },
  { key: "mod+shift+c", command: "thread.copyReference", when: "inSession" },
  { key: "mod+shift+m", command: "modelPicker.toggle", when: "inSession" },
  { key: "mod+shift+a", command: "composer.mode", when: "inSession" },
  { key: "mod+s", command: "composer.stash", when: "inSession" },
  { key: "mod+.", command: "turn.stop", when: "inSession" },
  { key: "mod+/", command: "shortcuts.open" },
  ...JUMP,
];

export const COMMAND_LABEL: Record<string, string> = {
  "commandPalette.toggle": "命令面板",
  "sidebar.toggle": "收起 / 展开左栏",
  "rightPanel.toggle": "收起 / 展开右栏",
  "diff.toggle": "打开改动",
  "chat.new": "新会话",
  "chat.find": "搜索会话",
  "filePicker.toggle": "打开文件",
  "thread.previous": "上一个会话",
  "thread.next": "下一个会话",
  "thread.pin": "置顶 / 取消置顶",
  "thread.settle": "归档 / 取消归档",
  "thread.copyReference": "复制会话链接",
  "modelPicker.toggle": "模型面板",
  "composer.mode": "轮换权限模式",
  "composer.stash": "暂存 / 取回草稿",
  "turn.stop": "停止这一轮",
  "shortcuts.open": "快捷键一览",
  "thread.jump": "跳到第 n 个会话",
};

export const isMac = (): boolean => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

// "mod+shift+[" -> 规范化的按键集合; mod 在 mac 上是 cmd, 其它是 ctrl
type Parsed = { ctrl: boolean; meta: boolean; alt: boolean; shift: boolean; key: string };
function parse(key: string): Parsed {
  const parts = key.toLowerCase().split("+");
  const k = parts.pop() as string;
  const has = (m: string) => parts.includes(m);
  const mac = isMac();
  return { ctrl: has("ctrl") || (has("mod") && !mac), meta: has("cmd") || has("meta") || (has("mod") && mac), alt: has("alt"), shift: has("shift"), key: k };
}

// 按物理键匹配, shift+[ 在美式键盘上 e.key 是 "{"
const SHIFTED: Record<string, string> = { "{": "[", "}": "]", "?": "/", ">": ".", "<": ",", "!": "1", "@": "2", "#": "3", "$": "4", "%": "5", "^": "6", "&": "7", "*": "8", "(": "9" };
function keyOf(e: KeyboardEvent): string {
  const k = e.key.toLowerCase();
  if (e.code.startsWith("Digit")) return e.code.slice(5);
  if (e.code === "BracketLeft") return "[";
  if (e.code === "BracketRight") return "]";
  if (e.code === "Slash") return "/";
  if (e.code === "Period") return ".";
  return SHIFTED[k] ?? k;
}

function whenOk(expr: string | undefined, ctx: Partial<Record<When, boolean>>): boolean {
  if (!expr) return true;
  return expr.split("&&").every((p) => {
    const t = p.trim();
    return t.startsWith("!") ? !ctx[t.slice(1) as When] : Boolean(ctx[t as When]);
  });
}

export function matchCommand(e: KeyboardEvent, ctx: Partial<Record<When, boolean>>, rules: Rule[] = DEFAULT_KEYBINDINGS): Command | null {
  if (e.isComposing) return null;
  const k = keyOf(e);
  for (const r of rules) {
    const p = parse(r.key);
    if (p.key !== k || p.ctrl !== e.ctrlKey || p.meta !== e.metaKey || p.alt !== e.altKey || p.shift !== e.shiftKey) continue;
    if (whenOk(r.when, ctx)) return r.command;
  }
  return null;
}

// 显示用: mac 用符号, 其它用 Ctrl+
export function formatKey(key: string): string[] {
  const mac = isMac();
  return key.split(/\+(?!$)/).map((p) => {
    const l = p.toLowerCase();
    if (l === "mod") return mac ? "⌘" : "Ctrl";
    if (l === "alt") return mac ? "⌥" : "Alt";
    if (l === "shift") return mac ? "⇧" : "Shift";
    if (l === "ctrl") return mac ? "⌃" : "Ctrl";
    return p.length === 1 ? p.toUpperCase() : p;
  });
}

export function keyFor(command: Command, rules: Rule[] = DEFAULT_KEYBINDINGS): string | undefined {
  return rules.find((r) => r.command === command)?.key;
}
