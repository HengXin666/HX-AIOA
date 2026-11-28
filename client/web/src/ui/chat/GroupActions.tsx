import { Label } from "@hx/ui/ui/label";
import { PATH_CHAT, PATH_CHAT_INVITES, PATH_CHAT_MEMBER, PATH_CHAT_MESSAGES, type ChatMeta, type ChatPatch, type RoomInviteCreated } from "@hx-aioa/protocol";
import { Button } from "@hx/ui/ui/button";
import { ConfirmDialog } from "@hx/ui/ui/confirm-dialog";
import { Input } from "@hx/ui/ui/input";
import { Switch } from "@hx/ui/ui/switch";
import { Textarea } from "@hx/ui/ui/textarea";
import { Check, Link2, Pencil } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useUser } from "../../app/hooks";
import { nav } from "../../app/router";
import { api, fill } from "../../core/auth";
import { chats, titleOf } from "../../core/chats";
import { MEMO_GROUP } from "../../core/constants";

const err = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));
const patch = (channel: string, p: ChatPatch) => chats.patch(channel, p).catch(err);

// 群设置里能改的部分 (对照安卓 GroupSettingsPage / ch-notice / ch-clear): 资料, 提醒, 展示方式, 邀请, 危险操作
export function GroupActions({ meta }: { meta: ChatMeta }) {
  const me = useUser();
  const owner = me?.role === "owner";
  const admin = owner || meta.role === "owner" || meta.role === "admin";
  const room = meta.members !== undefined;
  const dm = meta.kind === "dm";
  const ch = meta.channel;
  return (
    <div className="flex flex-col gap-4">
      {admin && !dm && <Editable label="群名" value={titleOf(meta)} onSave={(v) => patch(ch, { title: v })} />}
      {admin && !dm && <Editable label="群公告" value={meta.notice ?? ""} multiline onSave={(v) => patch(ch, { notice: v })} />}
      <div className="flex flex-col gap-2">
        <Toggle label="置顶" on={Boolean(meta.pinned)} set={(v) => patch(ch, { pinned: v })} />
        <Toggle label="免打扰" on={Boolean(meta.muted)} set={(v) => patch(ch, { muted: v })} />
        {admin && room && <Toggle label={`显示 "正在监听"`} on={!meta.hideListening} set={(v) => patch(ch, { hideListening: !v })} />}
        {admin && room && <Toggle label={`显示 "正在输入"`} on={!meta.hideTyping} set={(v) => patch(ch, { hideTyping: !v })} />}
        {owner && meta.view !== "mail" && <Toggle label="信息流展示" on={meta.view === "feed"} set={(v) => patch(ch, { view: v ? "feed" : "chat" })} />}
      </div>
      {(room || owner) && !dm && ch !== MEMO_GROUP && <Invite channel={ch} />}
      <Danger meta={meta} owner={owner} uid={me?.id} />
    </div>
  );
}

function Toggle({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <Label className="flex items-center justify-between gap-2 text-sm text-foreground">
      {label}
      <Switch size="sm" checked={on} onCheckedChange={set} />
    </Label>
  );
}

function Editable({ label, value, multiline, onSave }: { label: string; value: string; multiline?: boolean; onSave: (v: string) => Promise<unknown> }) {
  const [draft, setDraft] = useState<string | null>(null);
  const save = async () => {
    if (draft === null) return;
    await onSave(draft.trim());
    setDraft(null);
  };
  if (draft === null) {
    return (
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-sm break-words whitespace-pre-wrap text-foreground">{value || <span className="text-muted-foreground">未设置</span>}</p>
        </div>
        <Button size="icon-xs" variant="ghost" aria-label={`改${label}`} onClick={() => setDraft(value)}>
          <Pencil />
        </Button>
      </div>
    );
  }
  const field = multiline ? (
    <Textarea autoFocus rows={4} value={draft} onChange={(e) => setDraft(e.target.value)} />
  ) : (
    <Input autoFocus size="sm" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void save()} />
  );
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      {field}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
          取消
        </Button>
        <Button size="sm" onClick={() => void save()}>
          <Check />
          保存
        </Button>
      </div>
    </div>
  );
}

// 邀请链接: 默认有效期与次数由服务端定, 生成后直接复制
function Invite({ channel }: { channel: string }) {
  const [busy, setBusy] = useState(false);
  const make = async () => {
    setBusy(true);
    try {
      const r = await api<RoomInviteCreated>(fill(PATH_CHAT_INVITES, channel), { method: "POST", body: "{}" });
      await navigator.clipboard.writeText(r.link);
      toast.success("邀请链接已复制");
    } catch (e) {
      err(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button size="sm" variant="outline" disabled={busy} onClick={() => void make()}>
      <Link2 />
      复制邀请链接
    </Button>
  );
}

function Danger({ meta, owner, uid }: { meta: ChatMeta; owner: boolean; uid?: string }) {
  const ch = meta.channel;
  const actions: ReactNode[] = [];
  if (owner) {
    actions.push(
      <ConfirmDialog
        key="clear"
        trigger={<Button size="sm" variant="outline">清空聊天记录</Button>}
        title="清空聊天记录?"
        description="服务端存档一起删, 所有人的设备上都会清掉, 不能恢复。"
        confirmLabel="清空"
        tone="destructive"
        onConfirm={() => api(fill(PATH_CHAT_MESSAGES, ch), { method: "DELETE" }).then(() => toast.success("已清空"))}
      />,
    );
    if (ch !== MEMO_GROUP && meta.view !== "mail") {
      actions.push(
        <ConfirmDialog
          key="delete"
          trigger={<Button size="sm" variant="destructive">删除群</Button>}
          title={`删除 ${titleOf(meta)}?`}
          description="消息, 文件, 接入的 Agent, 成员与邀请一并删掉。"
          confirmText={titleOf(meta)}
          confirmLabel="删除"
          tone="destructive"
          onConfirm={() => api(fill(PATH_CHAT, ch), { method: "DELETE" }).then(() => nav("chat"))}
        />,
      );
    }
  } else if (uid && meta.members !== undefined && meta.kind !== "dm") {
    actions.push(
      <ConfirmDialog
        key="leave"
        trigger={<Button size="sm" variant="destructive">退出群</Button>}
        title={`退出 ${titleOf(meta)}?`}
        description="退出后看不到这个群的消息, 需要重新邀请才能回来。"
        confirmLabel="退出"
        tone="destructive"
        onConfirm={() => api(fill(PATH_CHAT_MEMBER, ch, uid), { method: "DELETE" }).then(() => nav("chat"))}
      />,
    );
  }
  if (!actions.length) return null;
  return <div className="flex flex-wrap gap-2 border-t border-border pt-3">{actions}</div>;
}
