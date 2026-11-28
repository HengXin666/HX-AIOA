import { PATH_FILE_LINK, type FileLink } from "@hx-aioa/protocol";
import { api, fill } from "./auth";

// 文件下载地址要带凭证去换 (24 小时有效, 带票据); 换到后图片直接用, 下载开新标签
const links = new Map<string, Promise<string | null>>();
const EARLY_MS = 60_000;

export function fileUrl(id: string): Promise<string | null> {
  let p = links.get(id);
  if (!p) {
    p = api<FileLink>(fill(PATH_FILE_LINK, id))
      .then((r) => {
        if (r?.expires) setTimeout(() => links.delete(id), Math.max(0, r.expires - Date.now() - EARLY_MS));
        return r?.url ?? null;
      })
      .catch(() => {
        links.delete(id);
        return null;
      });
    links.set(id, p);
  }
  return p;
}

// 先同步开一个空白页 (点击当下才不会被拦), 拿到 blob 再导过去; 不让新页拿到 opener
export async function openFile(id: string, name: string): Promise<void> {
  const w = window.open("about:blank", "_blank");
  if (w) w.opener = null;
  const url = await fileUrl(id);
  if (!url) {
    w?.close();
    throw new Error("取不到下载地址");
  }
  const res = await fetch(url).catch(() => null);
  if (!res?.ok) {
    if (w) w.location.href = url;
    return;
  }
  const blob = URL.createObjectURL(await res.blob());
  if (w) w.location.href = blob;
  else {
    const a = document.createElement("a");
    a.href = blob;
    a.download = name;
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(blob), 60_000);
}
