import type { DriveNode } from "@hx-aioa/protocol";
import { Card } from "@hx/ui/ui/card";
import {
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileText,
  FileVideo,
  File as FileIcon,
  Folder,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cached, isImage, load, peek, THUMB_MAX } from "../../core/blobcache";
import { sizeText } from "../MessageParts";
import { TONE, tint } from "../overview/parts";

// 文件类型 -> 图标与颜色 (同总览配色): 文件夹蓝, 图片青, 视频品红, 音频琥珀, 文档绿, 压缩包灰
export function typeOf(n: DriveNode): { icon: LucideIcon; color: string } {
  if (n.kind === "dir") return { icon: Folder, color: TONE.primary };
  const m = n.mime ?? "";
  if (m.startsWith("image/")) return { icon: FileImage, color: TONE.teal };
  if (m.startsWith("video/")) return { icon: FileVideo, color: TONE.accent };
  if (m.startsWith("audio/")) return { icon: FileAudio, color: TONE.amber };
  if (m === "application/pdf" || m.startsWith("text/"))
    return { icon: FileText, color: TONE.green };
  if (/json|xml|javascript|typescript|yaml/.test(m))
    return { icon: FileCode, color: TONE.green };
  if (/zip|tar|gzip|7z|rar|compressed/.test(m))
    return { icon: FileArchive, color: TONE.muted };
  return { icon: FileIcon, color: TONE.muted };
}

export function TypeIcon({
  n,
  size = "sm",
}: {
  n: DriveNode;
  size?: "sm" | "lg";
}) {
  const t = typeOf(n);
  const box =
    size === "lg"
      ? "size-14 rounded-xl [&>svg]:size-7"
      : "size-7 rounded-md [&>svg]:size-4";
  return (
    <span
      className={`grid shrink-0 place-items-center ${box}`}
      style={{ color: t.color, background: tint(t.color) }}
    >
      <t.icon />
    </span>
  );
}

// 缩略图: 小图片进入视口才取 (走本机缓存, 取过的预览与下载都不再请求)
function Thumb({ n }: { n: DriveNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const want = isImage(n) && n.size <= THUMB_MAX;
  const [src, setSrc] = useState<string | null>(() => (want ? peek(n) : null));
  useEffect(() => {
    if (!want || src || !ref.current) return;
    let live = true;
    const io = new IntersectionObserver((es) => {
      if (!es.some((e) => e.isIntersecting)) return;
      io.disconnect();
      load(n).then(
        (u) => live && setSrc(u),
        () => {},
      );
    });
    io.observe(ref.current);
    return () => {
      live = false;
      io.disconnect();
    };
  }, [n.id, want]);
  return (
    <div
      ref={ref}
      className="grid aspect-[4/3] place-items-center overflow-hidden rounded-lg bg-muted/40"
    >
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
        />
      ) : (
        <TypeIcon n={n} size="lg" />
      )}
    </div>
  );
}

export function DriveGrid({
  rows,
  onOpen,
  menu,
}: {
  rows: DriveNode[];
  onOpen: (n: DriveNode) => void;
  menu: (n: DriveNode) => ReactNode;
}) {
  return (
    <ul className="grid gap-3 py-3 [grid-template-columns:repeat(auto-fill,minmax(168px,1fr))]">
      {rows.map((n) => (
        <li key={n.id} className="group">
          <Card
            className="cursor-pointer gap-2 p-2 transition-colors hover:bg-muted/40"
            onClick={() => onOpen(n)}
          >
            <Thumb n={n} />
            <div className="flex items-center gap-1 px-1">
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-sm">{n.name}</span>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
                  {n.kind === "dir" ? "文件夹" : sizeText(n.size)}
                  {n.kind === "file" && cached(n) && (
                    <span
                      className="size-1.5 rounded-full"
                      style={{ background: TONE.success }}
                      title="已缓存到本机"
                    />
                  )}
                </span>
              </span>
              <span onClick={(e) => e.stopPropagation()}>{menu(n)}</span>
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}
