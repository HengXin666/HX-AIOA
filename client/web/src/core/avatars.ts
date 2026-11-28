import { PATH_AVATAR } from "@hx-aioa/protocol";
import { useEffect, useState } from "react";
import { accessToken, fill } from "./auth";

// 头像接口要带凭证, <img> 带不了请求头: 取一次转成 blob 地址; 头像 id 不变内容就不变, 进程内永久缓存
const cache = new Map<string, Promise<string | null>>();

function load(id: string): Promise<string | null> {
  let p = cache.get(id);
  if (!p) {
    p = (async () => {
      const token = await accessToken();
      if (!token) return null;
      const res = await fetch(fill(PATH_AVATAR, id), { headers: { authorization: `Bearer ${token}` } }).catch(() => null);
      return res?.ok ? URL.createObjectURL(await res.blob()) : null;
    })();
    cache.set(id, p);
  }
  return p;
}

export function useAvatar(id: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setUrl(null);
    if (id) void load(id).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [id]);
  return url;
}
