import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@hx/ui/ui/dialog";
import { Kbd, KbdGroup } from "@hx/ui/ui/kbd";
import { COMMAND_LABEL, DEFAULT_KEYBINDINGS, formatKey, keyFor, type Command } from "../../../agentgui/keybindings";

// 一个快捷键的按键帽
export function Keys({ k, className = "" }: { k?: string; className?: string }) {
  if (!k) return null;
  return (
    <KbdGroup className={className}>
      {formatKey(k).map((p) => (
        <Kbd key={p}>{p}</Kbd>
      ))}
    </KbdGroup>
  );
}

export const KeyOf = ({ command, className }: { command: Command; className?: string }) => <Keys k={keyFor(command)} className={className} />;

// 快捷键一览 (mod+/); 跳到第 n 个会话合成一行
export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const rows = DEFAULT_KEYBINDINGS.filter((r) => !r.command.startsWith("thread.jump."));
  const seen = new Set<string>();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>快捷键</DialogTitle>
          <DialogDescription>在输入框里也生效; 输入法组字时不触发。</DialogDescription>
        </DialogHeader>
        <ul className="flex max-h-[60vh] flex-col overflow-y-auto">
          {rows.map((r) => {
            if (seen.has(r.command)) return null;
            seen.add(r.command);
            return (
              <li key={r.command} className="flex items-center justify-between gap-4 border-b border-border py-2 text-sm last:border-0">
                <span className="text-foreground">{COMMAND_LABEL[r.command] ?? r.command}</span>
                <Keys k={r.key} />
              </li>
            );
          })}
          <li className="flex items-center justify-between gap-4 py-2 text-sm">
            <span className="text-foreground">{COMMAND_LABEL["thread.jump"]}</span>
            <Keys k="mod+1" />
          </li>
        </ul>
      </DialogContent>
    </Dialog>
  );
}
