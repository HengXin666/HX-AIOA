import { useTheme } from "@hx/ui/theme";
import { Spin } from "@hx/ui/ui/spin";
import { Toaster } from "@hx/ui/ui/sonner";
import { useEffect, useState } from "react";
import { hasRefresh, refresh } from "../core/auth";
import { chats } from "../core/chats";
import { link } from "../core/link";
import { Login } from "../ui/Login";
import { Shell } from "../ui/Shell";
import { useUser } from "./hooks";

const SKIN = "ink";

export function App() {
  const user = useUser();
  const [booting, setBooting] = useState(hasRefresh);
  const { accent, setAccent } = useTheme();

  // 默认皮肤与安卓一致 (ink); 用户在设置里换过就不动
  useEffect(() => {
    if (!localStorage.getItem("hx-theme") && accent !== SKIN) setAccent(SKIN);
  }, [accent, setAccent]);

  useEffect(() => {
    if (booting) void refresh().finally(() => setBooting(false));
  }, [booting]);

  useEffect(() => {
    if (!user) return;
    const off = chats.attach();
    // 列表先走 HTTP (带 ETag), 不等长连接; 连上后 welcome 再校验一次
    void chats.loadChats().catch(() => undefined);
    link.start();
    return () => {
      off();
      link.stop();
    };
  }, [user]);

  if (booting) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <Spin mode="fixed" />
      </div>
    );
  }
  return (
    <>
      {user ? <Shell /> : <Login />}
      <Toaster />
    </>
  );
}
