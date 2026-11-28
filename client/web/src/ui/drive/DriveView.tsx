import type { DriveNode, DriveStats } from "@hx-aioa/protocol";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@hx/ui/ui/breadcrumb";
import { Button } from "@hx/ui/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@hx/ui/ui/dropdown-menu";
import { Input } from "@hx/ui/ui/input";
import { Progress } from "@hx/ui/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@hx/ui/ui/table";
import { Download, Ellipsis, ExternalLink, File as FileIcon, Folder, FolderPlus, Link2, RefreshCw, Search, Send, Share2, Trash2, Upload, X } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { LOCALE, TXT_LOADING } from "../../core/constants";
import * as drive from "../../core/drive";
import { sizeText } from "../MessageParts";
import { err, joinPath, NameDialog, PickDir, SendToChat, ShareDialog, SharesDialog, TrashDialog } from "./DriveDialogs";

type Sort = "name" | "size" | "time";
// 搜索结果多带一个网盘内路径
type Row = DriveNode & { path?: string };
type Up = { key: string; name: string; sent: number; total: number; ctl: AbortController; error?: string };
type Dialog = { kind: "trash" | "shares" | "mkdir" } | { kind: "share" | "move" | "send" | "rename"; node: DriveNode } | null;

const byName = (a: DriveNode, b: DriveNode) => a.name.localeCompare(b.name, "zh");
const SORTS: Record<Sort, (a: DriveNode, b: DriveNode) => number> = { name: byName, size: (a, b) => b.size - a.size || byName(a, b), time: (a, b) => b.updatedAt - a.updatedAt };

async function openNode(n: DriveNode, download: boolean): Promise<void> {
  try {
    const url = await drive.linkOf(n.id);
    if (!download) return void window.open(url, "_blank", "noopener");
    const a = document.createElement("a");
    a.href = url;
    a.download = n.name;
    a.click();
  } catch (e) {
    err(e);
  }
}

// 网盘 (对照安卓 ui/drive, #154 #158): 面包屑, 排序, 搜索, 新建文件夹, 上传, 预览 / 下载在新标签页, 改名, 移动, 删除, 分享, 发到群, 回收站
export default function DriveView({ path, onPath }: { path: string; onPath: (p: string) => void }) {
  const [items, setItems] = useState<DriveNode[] | null>(() => drive.cachedList(path)?.items ?? null);
  const [stats, setStats] = useState<DriveStats | undefined>();
  const [sort, setSort] = useState<Sort>("name");
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Row[] | null>(null);
  const [ups, setUps] = useState<Up[]>([]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const load = (fresh = false) =>
    void drive.list(path, fresh).then(
      (l) => {
        setItems(l.items);
        if (l.stats !== undefined) setStats(l.stats ?? undefined);
        setError(null);
      },
      (e: Error) => setError(e.message),
    );
  useEffect(() => {
    setItems(drive.cachedList(path)?.items ?? null);
    setFound(null);
    load();
    return drive.driveChanged.on(() => load());
  }, [path]);

  const upload = (files: FileList | null) => {
    for (const f of Array.from(files ?? [])) {
      const key = `${Date.now()}-${f.name}`;
      const ctl = new AbortController();
      setUps((u) => [...u, { key, name: f.name, sent: 0, total: f.size, ctl }]);
      const set = (p: Partial<Up>) => setUps((u) => u.map((x) => (x.key === key ? { ...x, ...p } : x)));
      drive
        .upload(path, f, (sent, total) => set({ sent, total }), ctl.signal)
        .then(() => setUps((u) => u.filter((x) => x.key !== key)))
        .catch((e: Error) => set({ error: e.message }));
    }
    if (file.current) file.current.value = "";
  };

  const doSearch = () => (q.trim() ? void drive.search(q.trim()).then(setFound, err) : setFound(null));
  const segs = path.split("/").filter(Boolean);
  const rows: Row[] = found ?? [...(items ?? [])].sort((a, b) => Number(b.kind === "dir") - Number(a.kind === "dir") || SORTS[sort](a, b));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Breadcrumb className="min-w-0 flex-1">
          <BreadcrumbList>
            <BreadcrumbItem>{segs.length ? <BreadcrumbLink onClick={() => onPath("/")}>网盘</BreadcrumbLink> : <BreadcrumbPage>网盘</BreadcrumbPage>}</BreadcrumbItem>
            {segs.map((s, i) => (
              <Fragment key={i}>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  {i === segs.length - 1 ? <BreadcrumbPage>{s}</BreadcrumbPage> : <BreadcrumbLink onClick={() => onPath(`/${segs.slice(0, i + 1).join("/")}`)}>{s}</BreadcrumbLink>}
                </BreadcrumbItem>
              </Fragment>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
        <Input size="sm" className="w-48" leading={<Search />} placeholder="搜网盘 (回车)" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doSearch()} />
        <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "mkdir" })}>
          <FolderPlus />
          新建文件夹
        </Button>
        <Button size="sm" onClick={() => file.current?.click()}>
          <Upload />
          上传
        </Button>
        <input ref={file} type="file" multiple hidden onChange={(e) => upload(e.target.files)} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label="更多">
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => load(true)}>
              <RefreshCw />
              刷新
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setDialog({ kind: "shares" })}>
              <Link2 />
              我的分享
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setDialog({ kind: "trash" })}>
              <Trash2 />
              回收站
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {ups.length > 0 && (
        <div className="flex flex-col gap-1 border-b border-border px-3 py-2">
          {ups.map((u) => (
            <div key={u.key} className="flex items-center gap-2 text-xs">
              <span className="w-48 truncate text-foreground">{u.name}</span>
              {u.error ? <span className="flex-1 text-destructive">{u.error}</span> : <Progress className="flex-1" value={(u.sent / Math.max(1, u.total)) * 100} />}
              <span className="w-28 text-right text-muted-foreground">
                {sizeText(u.sent)} / {sizeText(u.total)}
              </span>
              <Button size="icon-xs" variant="ghost" aria-label="取消" onClick={() => (u.ctl.abort(), setUps((x) => x.filter((y) => y.key !== u.key)))}>
                <X />
              </Button>
            </div>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-3">
        {error && <p className="p-3 text-sm text-destructive">{error}</p>}
        {!items && !error && <p className="p-3 text-sm text-muted-foreground">{TXT_LOADING}</p>}
        {found && (
          <p className="flex items-center gap-2 pt-2 text-xs text-muted-foreground">
            搜到 {found.length} 项
            <Button size="xs" variant="ghost" onClick={() => (setFound(null), setQ(""))}>
              清除搜索
            </Button>
          </p>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="cursor-pointer" onClick={() => setSort("name")}>
                名字{sort === "name" ? " ↓" : ""}
              </TableHead>
              <TableHead className="w-28 cursor-pointer text-right" onClick={() => setSort("size")}>
                大小{sort === "size" ? " ↓" : ""}
              </TableHead>
              <TableHead className="hidden w-44 cursor-pointer sm:table-cell" onClick={() => setSort("time")}>
                修改时间{sort === "time" ? " ↓" : ""}
              </TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((n) => (
              <TableRow key={n.id} className="group cursor-pointer" onDoubleClick={() => (n.kind === "dir" ? onPath(n.path ?? joinPath(path, n.name)) : void openNode(n, false))}>
                <TableCell className="max-w-0" onClick={() => n.kind === "dir" && onPath(n.path ?? joinPath(path, n.name))}>
                  <span className="flex items-center gap-2 [&_svg]:size-4 [&_svg]:shrink-0">
                    {n.kind === "dir" ? <Folder className="text-brand" /> : <FileIcon className="text-muted-foreground" />}
                    <span className="truncate">{n.name}</span>
                  </span>
                  {n.path && <span className="block truncate text-xs text-muted-foreground">{n.path}</span>}
                </TableCell>
                <TableCell className="text-right text-muted-foreground">{n.kind === "dir" ? "" : sizeText(n.size)}</TableCell>
                <TableCell className="hidden text-muted-foreground sm:table-cell">{new Date(n.updatedAt).toLocaleString(LOCALE)}</TableCell>
                <TableCell>
                  <NodeMenu n={n} setDialog={setDialog} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {items?.length === 0 && !found && <p className="p-10 text-center text-sm text-muted-foreground">空文件夹, 点上传或新建文件夹</p>}
      </div>
      {stats && (
        <p className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
          已用 {sizeText(stats.bytes)} · {stats.files} 个文件 · {stats.dirs} 个文件夹
        </p>
      )}
      {dialog?.kind === "trash" && <TrashDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === "shares" && <SharesDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === "share" && <ShareDialog node={dialog.node} onClose={() => setDialog(null)} />}
      {dialog?.kind === "send" && <SendToChat node={dialog.node} onClose={() => setDialog(null)} />}
      {dialog?.kind === "mkdir" && <NameDialog title="新建文件夹" initial="" onSubmit={(name) => void drive.mkdir(joinPath(path, name)).catch(err)} onClose={() => setDialog(null)} />}
      {dialog?.kind === "rename" && <NameDialog title="改名" initial={dialog.node.name} onSubmit={(name) => void drive.rename(dialog.node.id, name).catch(err)} onClose={() => setDialog(null)} />}
      {dialog?.kind === "move" && <PickDir title={`移动 ${dialog.node.name}`} onPick={(to) => void drive.move(dialog.node.id, to).catch(err)} onClose={() => setDialog(null)} />}
    </div>
  );
}

function NodeMenu({ n, setDialog }: { n: DriveNode; setDialog: (d: Dialog) => void }) {
  const file = n.kind === "file";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon-xs" variant="ghost" aria-label="操作" className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100">
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {file && (
          <DropdownMenuItem onSelect={() => void openNode(n, false)}>
            <ExternalLink />
            在新标签页预览
          </DropdownMenuItem>
        )}
        {file && (
          <DropdownMenuItem onSelect={() => void openNode(n, true)}>
            <Download />
            下载
          </DropdownMenuItem>
        )}
        {file && (
          <DropdownMenuItem onSelect={() => setDialog({ kind: "send", node: n })}>
            <Send />
            发到群
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => setDialog({ kind: "share", node: n })}>
          <Share2 />
          分享
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setDialog({ kind: "rename", node: n })}>改名</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setDialog({ kind: "move", node: n })}>移动到</DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={() => void drive.remove(n.id).then(() => toast.success("已移到回收站"), err)}>
          <Trash2 />
          删除
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
