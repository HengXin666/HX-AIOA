import { Button } from "@hx/ui/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyMedia, EmptyTitle } from "@hx/ui/ui/empty";
import { Download, Smartphone } from "lucide-react";
import { APK_URL, EXTERNAL } from "../core/constants";

// 手机宽度不提供网页版: 两端逐页对齐代价太大, 手机上统一用 App
export function AppGate() {
  return (
    <div className="flex h-full items-center justify-center bg-background p-6">
      <Empty size="page" animate="rise">
        <EmptyMedia variant="icon">
          <Smartphone />
        </EmptyMedia>
        <EmptyTitle>手机上请用 App</EmptyTitle>
        <EmptyDescription>网页版只为电脑屏幕设计。安装安卓 App, 消息推送, 总览和 Agent 都在里面。</EmptyDescription>
        <EmptyContent>
          <Button asChild size="lg">
            <a href={APK_URL} {...EXTERNAL}>
              <Download />
              下载安卓 App
            </a>
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  );
}
