import type { DriveNode } from "@hx-aioa/protocol";
import { Badge } from "@hx/ui/ui/badge";
import { Button } from "@hx/ui/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@hx/ui/ui/dialog";
import { Spin } from "@hx/ui/ui/spin";
import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { cacheable, load, saveAs } from "../../core/blobcache";
import { linkOf } from "../../core/drive";
import { sizeText } from "../MessageParts";
import { err } from "./DriveDialogs";

const TEXT_MAX = 256 * 1024;
type Kind = "image" | "video" | "audio" | "text" | "pdf" | "other";

export function kindOf(n: DriveNode): Kind {
  const m = n.mime ?? "";
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  if (m === "application/pdf") return "pdf";
  if (
    m.startsWith("text/") ||
    /json|xml|yaml|javascript|typescript|markdown/.test(m)
  )
    return "text";
  return "other";
}

// 预览弹窗 (对照 HX-CF-Drive components/Preview.tsx): 能缓存的文件整份取进本机缓存再显示, 之后下载不走网络;
// 太大的视频音频直接用签名直链边播边取。
export function Preview({
  node,
  onClose,
}: {
  node: DriveNode | null;
  onClose: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [local, setLocal] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const kind = node ? kindOf(node) : "other";
  useEffect(() => {
    setSrc(null);
    setText(null);
    setLocal(false);
    if (!node) return;
    let live = true;
    const viaCache = cacheable(node);
    const get = viaCache ? load(node) : linkOf(node.id);
    get.then(
      async (u) => {
        if (!live) return;
        setSrc(u);
        setLocal(viaCache);
        if (kind === "text") {
          const t = await (await fetch(u)).text();
          if (live)
            setText(
              t.length > TEXT_MAX
                ? `${t.slice(0, TEXT_MAX)}\n\n(只显示前 256 KB)`
                : t,
            );
        }
      },
      (e) => live && err(e),
    );
    return () => {
      live = false;
    };
  }, [node?.id, node?.updatedAt]);

  const download = () =>
    node &&
    void saveAs(node).then(
      (w) => w === "cache" && toast.success("已从本机缓存保存, 没走网络"),
      err,
    );
  const wait = (
    <div className="grid h-[40vh] place-items-center text-sm text-muted-foreground">
      <span className="flex items-center gap-2">
        <Spin />
        正在取文件
      </span>
    </div>
  );
  return (
    <Dialog open={Boolean(node)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(92vw,1100px)] max-w-none sm:max-w-none">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3 pr-8">
            <span className="min-w-0 flex-1 truncate">{node?.name}</span>
            {local && (
              <Badge variant="outline" dot="success">
                已缓存到本机
              </Badge>
            )}
            <Button size="sm" variant="outline" onClick={download}>
              <Download />
              下载
            </Button>
          </DialogTitle>
          <DialogDescription>{node && sizeText(node.size)}</DialogDescription>
        </DialogHeader>
        {!src ? (
          kind === "other" ? null : (
            wait
          )
        ) : kind === "image" ? (
          <img
            src={src}
            alt={node?.name}
            className="max-h-[72vh] w-full rounded-lg object-contain"
          />
        ) : kind === "video" ? (
          <video
            src={src}
            controls
            autoPlay
            className="max-h-[72vh] w-full rounded-lg bg-black"
          />
        ) : kind === "audio" ? (
          <audio src={src} controls autoPlay className="w-full" />
        ) : kind === "text" ? (
          <pre className="max-h-[70vh] overflow-auto rounded-lg border bg-muted/40 p-4 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap">
            {text ?? "加载中"}
          </pre>
        ) : kind === "pdf" ? (
          <iframe
            src={src}
            title={node?.name}
            className="h-[72vh] w-full rounded-lg bg-white"
          />
        ) : null}
        {kind === "other" && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            这种文件没法在浏览器里预览, 点下载保存到本机
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
