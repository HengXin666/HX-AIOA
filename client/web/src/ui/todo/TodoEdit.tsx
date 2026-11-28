import { Label } from "@hx/ui/ui/label";
import type { TodoPriority, TodoState } from "@hx-aioa/protocol";
import { Button } from "@hx/ui/ui/button";
import { ConfirmDialog } from "@hx/ui/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@hx/ui/ui/dialog";
import { Field } from "@hx/ui/ui/field";
import { Input } from "@hx/ui/ui/input";
import { Switch } from "@hx/ui/ui/switch";
import { Textarea } from "@hx/ui/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@hx/ui/ui/toggle-group";
import { MessageSquare, Trash2 } from "lucide-react";
import { useState } from "react";
import { nav } from "../../app/router";
import { chats, titleOf } from "../../core/chats";
import { todos, type TodoDraft } from "../../core/todos";
import { PRIO_LABEL, STATE_LABEL, STATES } from "./model";

const pad = (n: number) => String(n).padStart(2, "0");
// <input type="datetime-local"> 用本地时间字符串
const toLocal = (ms?: number) => {
  if (!ms) return "";
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// 新建 / 编辑待办 (对照安卓 todo/TodoEdit.kt + TodoSheet.kt)
export function TodoEdit({ draft, fresh, areas, onClose }: { draft: TodoDraft; fresh: boolean; areas: string[]; onClose: () => void }) {
  const [d, setD] = useState<TodoDraft>(draft);
  const set = <K extends keyof TodoDraft>(k: K, v: TodoDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const save = () => {
    void todos.save({ ...d, title: d.title.trim(), note: d.note?.trim() || undefined }, fresh);
    onClose();
  };
  const group = chats.meta(d.channel);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{fresh ? "新建待办" : "编辑待办"}</DialogTitle>
          <DialogDescription>在 {group ? titleOf(group) : d.channel}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
          <Field label="标题">
            <Input autoFocus value={d.title} onChange={(e) => set("title", e.target.value)} onKeyDown={(e) => e.key === "Enter" && d.title.trim() && save()} />
          </Field>
          <Field label="备注">
            <Textarea rows={3} value={d.note ?? ""} onChange={(e) => set("note", e.target.value)} />
          </Field>
          <Field label="状态">
            <ToggleGroup type="single" variant="outline" size="sm" value={d.state === "dropped" ? "done" : d.state} onValueChange={(v) => v && set("state", v as TodoState)}>
              {STATES.map((s) => (
                <ToggleGroupItem key={s} value={s}>
                  {STATE_LABEL[s]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>
          <Field label="优先级">
            <ToggleGroup type="single" variant="outline" size="sm" value={String(d.prio)} onValueChange={(v) => v && set("prio", Number(v) as TodoPriority)}>
              {([1, 2, 3] as const).map((p) => (
                <ToggleGroupItem key={p} value={String(p)}>
                  {PRIO_LABEL[p]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>
          <Field label="分区">
            <div className="flex flex-wrap gap-1">
              {areas.map((a) => (
                <Button key={a} size="xs" variant={d.area === a ? "secondary" : "ghost"} onClick={() => set("area", d.area === a ? undefined : a)}>
                  {a}
                </Button>
              ))}
              <Input size="sm" className="w-28" placeholder="自定义" value={d.area && !areas.includes(d.area) ? d.area : ""} onChange={(e) => set("area", e.target.value || undefined)} />
            </div>
          </Field>
          <Field label="截止">
            <Input type="datetime-local" value={toLocal(d.due)} onChange={(e) => set("due", e.target.value ? new Date(e.target.value).getTime() : undefined)} />
          </Field>
          <Label className="flex items-center justify-between text-sm text-foreground">
            重点 (上总览)
            <Switch size="sm" checked={Boolean(d.star)} onCheckedChange={(v) => set("star", v || undefined)} />
          </Label>
          {d.src && (
            <Button
              size="sm"
              variant="ghost"
              className="self-start"
              onClick={() => {
                onClose();
                nav("chat", d.channel, String(d.src));
              }}
            >
              <MessageSquare />
              跳到来源消息
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!fresh && (
            <ConfirmDialog
              trigger={
                <Button variant="ghost" size="sm">
                  <Trash2 />
                  删除
                </Button>
              }
              title="删除这条待办?"
              confirmLabel="删除"
              tone="destructive"
              onConfirm={() => {
                const t = todos.all().find((x) => x.channel === d.channel && x.id === d.id);
                onClose();
                return t ? todos.remove(t) : undefined;
              }}
            />
          )}
          <Button className="ml-auto" disabled={!d.title.trim()} onClick={save}>
            保存
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
