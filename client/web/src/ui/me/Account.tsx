import type { Me } from "@hx-aioa/protocol";
import { Button } from "@hx/ui/ui/button";
import { ConfirmDialog } from "@hx/ui/ui/confirm-dialog";
import { Input } from "@hx/ui/ui/input";
import { Camera, LogOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useMyFace, useUser } from "../../app/hooks";
import { logout } from "../../core/auth";
import { changePassword, dropDevice, loadMe, patchMe, uploadAvatar } from "../../core/account";
import { LOCALE, TXT_LOADING } from "../../core/constants";
import { shortTime } from "../ChatList";
import { UserAvatar } from "../UserAvatar";
import { errText, Group, Row } from "./parts";

const MIN_PASSWORD = 8;

// 账号 (对照安卓 me-account): 头像, 昵称, 改密码, 登录设备
export default function Account() {
  const user = useUser();
  const [me, setMe] = useState<Me | null>(null);
  const reload = () => void loadMe().then(setMe).catch((e) => toast.error(errText(e)));
  useEffect(reload, []);
  if (!user) return null;
  return (
    <>
      <Profile />
      <Password />
      <Group title="登录设备">
        {!me && <p className="text-sm text-muted-foreground">{TXT_LOADING}</p>}
        {me?.devices.map((d) => (
          <div key={d.id} className="flex items-center gap-2 text-sm">
            <div className="min-w-0 flex-1">
              <p className="truncate text-foreground">
                {d.name || d.platform} {d.current && <span className="text-xs text-success">本机</span>}
              </p>
              <p className="text-xs text-muted-foreground">
                {new Date(d.created).toLocaleDateString(LOCALE)} 登录 · {shortTime(d.seen)} 活跃
              </p>
            </div>
            {!d.current && (
              <ConfirmDialog
                trigger={<Button size="sm" variant="ghost">下线</Button>}
                title={`让 ${d.name || d.platform} 下线?`}
                description="这台设备需要重新登录。"
                confirmLabel="下线"
                tone="destructive"
                onConfirm={() => dropDevice(d.id).then(reload)}
              />
            )}
          </div>
        ))}
      </Group>
      <Button variant="outline" onClick={() => void logout()}>
        <LogOut />
        退出登录
      </Button>
    </>
  );
}

function Profile() {
  const user = useUser()!;
  const face = useMyFace();
  const [name, setName] = useState(user.display);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => setName(user.display), [user.display]);
  const pick = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      await patchMe({ avatar: await uploadAvatar(f) });
      toast.success("头像已更新");
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  };
  const save = () => void patchMe({ display: name.trim() }).then(() => toast.success("已保存"), (e) => toast.error(errText(e)));
  return (
    <Group title="资料">
      <div className="flex items-center gap-3">
        <button type="button" disabled={busy} onClick={() => file.current?.click()} className="group relative rounded-full" aria-label="换头像">
          <UserAvatar id={face} name={user.display} size="lg" />
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 text-white opacity-0 group-hover:opacity-100 [&_svg]:size-4">
            <Camera />
          </span>
        </button>
        <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => void pick(e.target.files?.[0])} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-muted-foreground">@{user.name}</p>
          <div className="mt-1 flex gap-2">
            <Input size="sm" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
            <Button size="sm" disabled={!name.trim() || name.trim() === user.display} onClick={save}>
              保存
            </Button>
          </div>
        </div>
      </div>
      <Row label="身份" value={user.role === "owner" ? "主人" : user.role === "admin" ? "管理员" : "成员"} />
    </Group>
  );
}

function Password() {
  const [old, setOld] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const ok = old && next.length >= MIN_PASSWORD;
  const submit = async () => {
    setBusy(true);
    try {
      await changePassword(old, next);
      toast.success("密码已改, 其他设备需要重新登录");
      setOld("");
      setNext("");
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Group title="改密码">
      <Input size="sm" type="password" autoComplete="current-password" placeholder="旧密码" value={old} onChange={(e) => setOld(e.target.value)} />
      <Input size="sm" type="password" autoComplete="new-password" placeholder={`新密码 (至少 ${MIN_PASSWORD} 位)`} value={next} onChange={(e) => setNext(e.target.value)} />
      <Button size="sm" disabled={!ok || busy} onClick={() => void submit()}>
        改密码
      </Button>
    </Group>
  );
}
