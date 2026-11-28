import { Button } from "@hx/ui/ui/button";
import { PanelLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { useAgPrefs } from "../../../agentgui/prefs";
import { BP_MID, BP_WIDE } from "../../../core/constants";
import { useGui } from "./ctx";

export function useWide(bp = BP_WIDE): boolean {
  const [w, setW] = useState(() => window.innerWidth >= bp);
  useEffect(() => {
    const q = matchMedia(`(min-width: ${bp}px)`);
    const on = () => setW(q.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, [bp]);
  return w;
}

// 左栏收起 (或窄屏) 时顶栏左侧的开关
export function SidebarButton() {
  const { toggleSidebar } = useGui();
  const prefs = useAgPrefs();
  const narrow = !useWide(BP_MID);
  if (!narrow && !prefs.sidebarOff) return null;
  return (
    <Button size="icon-sm" variant="ghost" aria-label="展开左栏" onClick={toggleSidebar}>
      <PanelLeft />
    </Button>
  );
}
