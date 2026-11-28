import { Label } from "@hx/ui/ui/label";
import type { InviteInfo, UserPublic } from "@hx-aioa/protocol";
import { Badge } from "@hx/ui/ui/badge";
import { Button } from "@hx/ui/ui/button";
import { ConfirmDialog } from "@hx/ui/ui/confirm-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@hx/ui/ui/dropdown-menu";
import { Switch } from "@hx/ui/ui/switch";
import { Copy, Ellipsis, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useUser } from "../../app/hooks";
import { approveUser, createInvite, deleteUser, dropInvite, listInvites, listUsers, patchUser } from "../../core/account";
import { LOCALE, TXT_LOADING } from "../../core/constants";
import { UserAvatar } from "../UserAvatar";
import { errText, Group } from "./parts";

const ROLE = { owner: "主人", admin: "管理员", member: "成员" } as const;
const STATUS = { active: "", pending: "待审批", disabled: "已停用" } as const;
const copy = (t: string) => void navigator.clipboard.writeText(t).then(() => toast.success("邀请码已复制"));

// 成员与邀请 (对照安卓 me-members, 主人 / 管理员可见)
export default function Members() {
  const me = useUser();
  const [users, setUsers] = useState<UserPublic[] | null>(null);
  const [invites, setInvites] = useState<InviteInfo[] | null>(null);
  const [approval, setApproval] = useState(false);
  const reload = () => {
    void listUsers().then(setUsers, (e) => toast.error(errText(e)));
    void listInvites().then(setInvites, () => setInvites([]));
  };
  useEffect(reload, []);
  const act = (p: Promise<unknown>) => void p.then(reload, (e) => toast.error(errText(e)));

  const invite = async () => {
    try {
      const r = await createInvite({ role: "member", needsApproval: approval });
      copy(r.code);
      reload();
    } catch (e) {
      toast.error(errText(e));
    }
  };

  return (
    <>
      <Group title={`成员${users ? ` (${users.length})` : ""}`}>
        {!users && <p className="text-sm text-muted-foreground">{TXT_LOADING}</p>}
        {users?.map((u) => (
          <div key={u.id} className="flex items-center gap-2">
            <UserAvatar id={u.avatar} name={u.display} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-foreground">{u.display}</p>
              <p className="truncate text-xs text-muted-foreground">@{u.name}</p>
            </div>
            {STATUS[u.status] && <Badge variant="outline">{STATUS[u.status]}</Badge>}
            <Badge variant="secondary">{ROLE[u.role]}</Badge>
            {u.status === "pending" && (
              <Button size="sm" onClick={() => act(approveUser(u.id))}>
                批准
              </Button>
            )}
            {u.role !== "owner" && u.id !== me?.id && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon-xs" variant="ghost" aria-label="更多">
                    <Ellipsis />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {me?.role === "owner" && (
                    <DropdownMenuItem onSelect={() => act(patchUser(u.id, { role: u.role === "admin" ? "member" : "admin" }))}>{u.role === "admin" ? "设为成员" : "设为管理员"}</DropdownMenuItem>
                  )}
                  <DropdownMenuItem onSelect={() => act(patchUser(u.id, { status: u.status === "disabled" ? "active" : "disabled" }))}>{u.status === "disabled" ? "恢复" : "停用"}</DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onSelect={() => act(deleteUser(u.id))}>
                    <Trash2 />
                    删除
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        ))}
      </Group>
      <Group title="邀请">
        <Label className="flex items-center justify-between gap-2 text-sm text-foreground">
          加入后需要我批准
          <Switch size="sm" checked={approval} onCheckedChange={setApproval} />
        </Label>
        <Button size="sm" onClick={() => void invite()}>
          <Plus />
          新建邀请码并复制
        </Button>
        {invites?.filter((i) => !i.usedBy).map((i) => (
          <div key={i.id} className="flex items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate text-foreground">
              {ROLE[i.role]}
              {i.needsApproval ? " · 需批准" : ""}
            </span>
            <span className="text-xs text-muted-foreground">{new Date(i.expires).toLocaleString(LOCALE)} 过期</span>
            <ConfirmDialog trigger={<Button size="icon-xs" variant="ghost" aria-label="作废"><Trash2 /></Button>} title="作废这个邀请?" confirmLabel="作废" tone="destructive" onConfirm={() => dropInvite(i.id).then(reload)} />
          </div>
        ))}
        <p className="flex items-center gap-1 text-xs text-muted-foreground [&_svg]:size-3">
          <Copy />
          邀请码只在新建时显示一次, 对方在登录页用它注册。
        </p>
      </Group>
    </>
  );
}
