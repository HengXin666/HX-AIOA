import type { DriveNode, DriveShare, DriveTrashItem } from "@hx-aioa/protocol";
import { Button } from "@hx/ui/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@hx/ui/ui/command";
import { ConfirmDialog } from "@hx/ui/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@hx/ui/ui/dialog";
import { Field } from "@hx/ui/ui/field";
import { Input } from "@hx/ui/ui/input";
import { Table, TableBody, TableCell, TableRow } from "@hx/ui/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@hx/ui/ui/toggle-group";
import { Copy, Folder, Trash2, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { chats, titleOf } from "../../core/chats";
import { LOCALE, TXT_LOADING } from "../../core/constants";
import * as drive from "../../core/drive";
import { link } from "../../core/link";
import { sizeText } from "../MessageParts";
import { UserAvatar } from "../UserAvatar";

export const err = (e: unknown) =>
  toast.error(e instanceof Error ? e.message : String(e));
const copy = (t: string, ok: string) =>
  void navigator.clipboard.writeText(t).then(() => toast.success(ok));
const DAY_SEC = 86_400;
const TTLS = [
  { v: "0", label: "永久" },
  { v: String(DAY_SEC), label: "1 天" },
  { v: String(7 * DAY_SEC), label: "7 天" },
  { v: String(30 * DAY_SEC), label: "30 天" },
];
const FILE_TEXT_PREFIX = "[文件] ";
export const joinPath = (dir: string, name: string) =>
  dir === "/" ? `/${name}` : `${dir}/${name}`;

// 回收站 (对照安卓 ov-drive-trash): 恢复, 彻底删除, 清空
export function TrashDialog({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<DriveTrashItem[] | null>(null);
  const load = () => void drive.trash().then(setItems, err);
  useEffect(load, []);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>回收站</DialogTitle>
          <DialogDescription>
            {items ? `${items.length} 项` : TXT_LOADING}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Table>
            <TableBody>
              {items?.map((n) => (
                <TableRow key={n.id}>
                  <TableCell className="max-w-0 truncate">{n.name}</TableCell>
                  <TableCell className="w-28 text-muted-foreground">
                    {new Date(n.deletedAt).toLocaleDateString(LOCALE)}
                  </TableCell>
                  <TableCell className="w-24 text-right">
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label="恢复"
                      onClick={() => void drive.restore(n.id).then(load, err)}
                    >
                      <Undo2 />
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label="彻底删除"
                      onClick={() => void drive.purge(n.id).then(load, err)}
                    >
                      <Trash2 />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <ConfirmDialog
          trigger={
            <Button variant="outline" disabled={!items?.length}>
              清空回收站
            </Button>
          }
          title="清空回收站?"
          description="里面的文件会被彻底删除, 不能恢复。"
          confirmLabel="清空"
          tone="destructive"
          onConfirm={() => drive.emptyTrash().then(load)}
        />
      </DialogContent>
    </Dialog>
  );
}

// 我的分享 (对照安卓 ov-drive-shares): 链接, 到期, 密码, 复制, 撤销
export function SharesDialog({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<DriveShare[] | null>(null);
  const load = () => void drive.shares().then(setItems, err);
  useEffect(load, []);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>我的分享</DialogTitle>
          <DialogDescription>
            {items ? `${items.length} 个` : TXT_LOADING}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Table>
            <TableBody>
              {items?.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="max-w-0 truncate">{s.name}</TableCell>
                  <TableCell className="w-32 text-xs text-muted-foreground">
                    {s.expiresAt
                      ? `${new Date(s.expiresAt).toLocaleDateString(LOCALE)} 到期`
                      : "永久"}
                    {s.hasPassword ? " · 有密码" : ""}
                  </TableCell>
                  <TableCell className="w-24 text-right">
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label="复制链接"
                      onClick={() => copy(s.url, "链接已复制")}
                    >
                      <Copy />
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label="撤销"
                      onClick={() => void drive.unshare(s.id).then(load, err)}
                    >
                      <Trash2 />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// 新建分享: 有效期与可选密码; 链接与密码分开复制
export function ShareDialog({
  node,
  onClose,
}: {
  node: DriveNode;
  onClose: () => void;
}) {
  const [ttl, setTtl] = useState(String(7 * DAY_SEC));
  const [pwd, setPwd] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  const create = async () => {
    try {
      const r = await drive.share(
        node.id,
        Number(ttl) || undefined,
        pwd || undefined,
      );
      const all = await drive.shares();
      const u = all.find((s) => s.id === r.id)?.url ?? "";
      setUrl(u);
      copy(u, "链接已复制");
    } catch (e) {
      err(e);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>分享 {node.name}</DialogTitle>
          <DialogDescription>
            打开链接的人不用登录; 设了密码要先输入。
          </DialogDescription>
        </DialogHeader>
        <Field label="有效期">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={ttl}
            onValueChange={(v) => v && setTtl(v)}
          >
            {TTLS.map((t) => (
              <ToggleGroupItem key={t.v} value={t.v}>
                {t.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>
        <Field label="密码 (可选)">
          <Input
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
            maxLength={64}
          />
        </Field>
        {url ? (
          <div className="flex gap-2">
            <Input readOnly value={url} />
            <Button variant="outline" onClick={() => copy(url, "链接已复制")}>
              复制链接
            </Button>
            {pwd && (
              <Button variant="outline" onClick={() => copy(pwd, "密码已复制")}>
                复制密码
              </Button>
            )}
          </div>
        ) : (
          <Button onClick={() => void create()}>生成链接</Button>
        )}
      </DialogContent>
    </Dialog>
  );
}

// 选目录 (移动到): 从根开始逐级点进去
export function PickDir({
  title,
  onPick,
  onClose,
}: {
  title: string;
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  const [path, setPath] = useState("/");
  const [dirs, setDirs] = useState<DriveNode[] | null>(null);
  useEffect(() => {
    setDirs(null);
    void drive
      .list(path)
      .then((l) => setDirs(l.items.filter((n) => n.kind === "dir")), err);
  }, [path]);
  const up = path === "/" ? null : path.slice(0, path.lastIndexOf("/")) || "/";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="break-all">{path}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {up && (
            <Button
              variant="ghost"
              className="justify-start"
              onClick={() => setPath(up)}
            >
              ..
            </Button>
          )}
          {!dirs && (
            <p className="text-sm text-muted-foreground">{TXT_LOADING}</p>
          )}
          {dirs?.map((d) => (
            <Button
              key={d.id}
              variant="ghost"
              className="justify-start"
              onClick={() => setPath(joinPath(path, d.name))}
            >
              <Folder />
              {d.name}
            </Button>
          ))}
        </div>
        <Button
          onClick={() => {
            onPick(path);
            onClose();
          }}
        >
          移到这里
        </Button>
      </DialogContent>
    </Dialog>
  );
}

// 发到群 (#157): 只列能发消息的会话, 邮件群与信息流群不列
export function SendToChat({
  node,
  onClose,
}: {
  node: DriveNode;
  onClose: () => void;
}) {
  const pick = async (channel: string) => {
    onClose();
    try {
      const r = await drive.attach(node.id, channel);
      link.send({
        body: { kind: "text", text: FILE_TEXT_PREFIX + node.name },
        channel,
        file: r.file.id,
      });
      toast.success(
        `已发到 ${titleOf(chats.meta(channel) ?? { channel, updated: 0 })}`,
      );
    } catch (e) {
      err(e);
    }
  };
  return (
    <CommandDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="发到群"
      description={`${node.name} · ${sizeText(node.size)}`}
    >
      <CommandInput placeholder="发到群..." />
      <CommandList>
        <CommandEmpty>没有匹配的会话</CommandEmpty>
        <CommandGroup heading={`发送 ${node.name}`}>
          {chats
            .ordered()
            .filter((c) => !c.view || c.view === "chat")
            .map((c) => (
              <CommandItem
                key={c.channel}
                value={`${titleOf(c)} ${c.channel}`}
                onSelect={() => void pick(c.channel)}
              >
                <UserAvatar id={c.avatar} name={titleOf(c)} size="sm" />
                {titleOf(c)}
              </CommandItem>
            ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

// 输入名字 (新建文件夹, 改名)
export function NameDialog({
  title,
  initial,
  onSubmit,
  onClose,
}: {
  title: string;
  initial: string;
  onSubmit: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  const ok = name.trim() && name.trim() !== initial && !name.includes("/");
  const submit = () => {
    if (!ok) return;
    onSubmit(name.trim());
    onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>名字里不能有 /</DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        <Button disabled={!ok} onClick={submit}>
          确定
        </Button>
      </DialogContent>
    </Dialog>
  );
}
