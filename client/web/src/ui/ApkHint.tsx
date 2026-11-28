import { Button } from "@hx/ui/ui/button";
import { Smartphone, X } from "lucide-react";
import { useState } from "react";
import { APK_URL, EXTERNAL, STORAGE_HINT_APK } from "../core/constants";

const isAndroid = () => /Android/i.test(navigator.userAgent);

// 安卓手机浏览器里提示一次 App: 后台常驻推送, 内置浏览器, 代理这些网页做不到; 关掉就不再出现
export function ApkHint() {
  const [show, setShow] = useState(() => isAndroid() && !localStorage.getItem(STORAGE_HINT_APK));
  if (!show) return null;
  const close = () => {
    localStorage.setItem(STORAGE_HINT_APK, "1");
    setShow(false);
  };
  return (
    <div className="flex w-full max-w-sm items-center gap-3 rounded-xl border border-border bg-card p-3 text-sm">
      <Smartphone className="size-5 shrink-0 text-muted-foreground" />
      <p className="flex-1 text-muted-foreground">手机上建议装安卓 App: 后台收消息更及时, 更省电。</p>
      <Button asChild size="sm" variant="secondary">
        <a href={APK_URL} {...EXTERNAL}>
          下载
        </a>
      </Button>
      <Button size="icon-sm" variant="ghost" aria-label="不再提示" onClick={close}>
        <X />
      </Button>
    </div>
  );
}
