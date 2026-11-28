import { BUNDLE_VIA_DEPTH, type BundleInfo, type FileRef } from "@hx-aioa/protocol";
import { File as FileIcon, Layers } from "lucide-react";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { fileUrl, openFile } from "../core/files";
import { EXTERNAL } from "../core/constants";

const BundleView = lazy(() => import("./chat/BundleView"));

const URL_RE = /(https?:\/\/[^\s<>"']+)/g;
const MENTION_RE = /(@[^\s@,.!?，。!?]+)/g;

// 站内一律新标签页打开, 不内嵌浏览器 (见 docs/design/web-arch.md 第 5 节); @ 提及加粗着色
export function richText(text: string): ReactNode[] {
  return text.split(URL_RE).flatMap((part, i) =>
    i % 2 === 1
      ? [
          <a key={i} href={part} {...EXTERNAL} className="break-all text-brand underline-offset-2 hover:underline">
            {part}
          </a>,
        ]
      : part.split(MENTION_RE).map((s, j) =>
          j % 2 === 1 ? (
            <span key={`${i}-${j}`} className="font-medium text-brand">
              {s}
            </span>
          ) : (
            s
          ),
        ),
  );
}

// HTML 卡片: 沙箱 iframe, 不给脚本; 链接从新标签页打开
export function HtmlCard({ html }: { html: string }) {
  const doc = `<!doctype html><meta charset="utf-8"><base target="_blank"><style>body{margin:0;font:14px system-ui;color-scheme:light dark}img{max-width:100%}</style>${html}`;
  return <iframe title="卡片" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={doc} className="h-64 w-full max-w-xl rounded-lg border border-border bg-background" loading="lazy" />;
}

export function sizeText(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

const open = (f: FileRef) => void openFile(f.id, f.name).catch((e: Error) => toast.error(e.message));

// 附件: 图片显示缩略图 (下载地址带票据, img 直接用), 其他文件一张卡片; 点开都在新标签页
export function FileView({ file }: { file: FileRef }) {
  const image = file.mime.startsWith("image/");
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!image) return;
    let live = true;
    void fileUrl(file.id).then((u) => live && setSrc(u));
    return () => {
      live = false;
    };
  }, [file.id, image]);
  if (image && src) {
    return (
      <button type="button" onClick={() => open(file)} className="block overflow-hidden rounded-lg border border-border">
        <img src={src} alt={file.name} loading="lazy" className="max-h-64 max-w-[16rem] object-cover" />
      </button>
    );
  }
  return (
    <button type="button" onClick={() => open(file)} className="flex w-64 max-w-full items-center gap-3 rounded-lg border border-border bg-card p-2 text-left hover:bg-muted">
      <FileIcon className="size-8 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-foreground">{file.name}</span>
        <span className="text-xs text-muted-foreground">{sizeText(file.size)}</span>
      </span>
    </button>
  );
}

// 合并转发卡片: 只显示摘要 (前 4 条), 详情接口后续再接
// 合并转发卡片: 点开看详情 (懒加载); 嵌套超过服务端允许的层数时只显示摘要
export function BundleCard({ b, via }: { b: BundleInfo; via: number[] }) {
  const [open, setOpen] = useState(false);
  const can = via.length <= BUNDLE_VIA_DEPTH;
  return (
    <>
      <button type="button" disabled={!can} onClick={() => setOpen(true)} className="w-64 max-w-full rounded-lg border border-border bg-card p-2 text-left text-sm hover:bg-muted disabled:hover:bg-card">
        <div className="mb-1 flex items-center gap-1 font-medium text-foreground">
          <Layers className="size-4 text-muted-foreground" />
          {b.from} 的聊天记录
        </div>
        {b.head.map((h, i) => (
          <p key={i} className="truncate text-xs text-muted-foreground">
            {h.src}: {h.text}
          </p>
        ))}
        <p className="mt-1 border-t border-border pt-1 text-xs text-muted-foreground">共 {b.count} 条</p>
      </button>
      {open && (
        <Suspense fallback={null}>
          <BundleView b={b} via={via} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
