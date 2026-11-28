import { useEffect, useState } from "react";
import { ApiError } from "../../core/auth";

export type Loaded<T> = { data: T | null; error: string | null; status: number; busy: boolean };

// 进页时请求一次, 不轮询; key 变了 (换仓库) 再请求
export function useOnce<T>(key: string | null, fn: () => Promise<T>): Loaded<T> {
  const [s, setS] = useState<Loaded<T>>({ data: null, error: null, status: 0, busy: Boolean(key) });
  useEffect(() => {
    if (!key) return;
    let live = true;
    setS({ data: null, error: null, status: 0, busy: true });
    fn()
      .then((data) => live && setS({ data, error: null, status: 200, busy: false }))
      .catch((e: unknown) => live && setS({ data: null, error: e instanceof Error ? e.message : String(e), status: e instanceof ApiError ? e.status : 0, busy: false }));
    return () => {
      live = false;
    };
    // fn 每次渲染都是新的, 只按 key 请求
  }, [key]);
  return s;
}
