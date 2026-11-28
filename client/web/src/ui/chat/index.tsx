import { lazy, Suspense, useEffect, useState } from "react";
import { setPane, usePane } from "../../app/hooks";
import { nav } from "../../app/router";
import { chats } from "../../core/chats";
import { TXT_PICK_CHAT } from "../../core/constants";
import { ChatList } from "../ChatList";
import { Conversation } from "../Conversation";
import { EmptyState, TwoPane } from "../kit/Panes";
import type { AreaProps } from "../Shell";

const InspectorPane = lazy(() => import("../Inspector").then((m) => ({ default: m.InspectorPane })));
const InspectorSheet = lazy(() => import("../Inspector").then((m) => ({ default: m.InspectorSheet })));

// 消息栏: #/chat (列表) · #/chat/<群> (会话)
export default function ChatArea({ loc, layout }: AreaProps) {
  const channel = loc.path[0] ?? null;
  const pane = usePane();
  const [drawer, setDrawer] = useState(false);
  const paneOpen = layout === "wide" ? pane : drawer;
  const togglePane = () => (layout === "wide" ? setPane(!pane) : setDrawer(!drawer));
  useEffect(() => setDrawer(false), [channel, layout]);
  useChatKeys(channel, () => (layout === "wide" ? setPane(false) : setDrawer(false)));

  const detail = channel ? <Conversation key={channel} channel={channel} focus={Number(loc.path[1]) || undefined} narrow={layout === "narrow"} pane={paneOpen} onPane={togglePane} /> : <EmptyState>{TXT_PICK_CHAT}</EmptyState>;
  const aside =
    channel && layout === "wide" && pane ? (
      <Suspense fallback={null}>
        <InspectorPane channel={channel} onClose={() => setPane(false)} />
      </Suspense>
    ) : undefined;
  return (
    <>
      <TwoPane layout={layout} showDetail={Boolean(channel)} list={<ChatList active={channel} />} detail={detail} aside={aside} />
      <Suspense fallback={null}>
        {channel && layout !== "wide" && drawer && <InspectorSheet channel={channel} open={drawer} side={layout === "mid" ? "right" : "bottom"} onClose={() => setDrawer(false)} />}
      </Suspense>
    </>
  );
}

// Alt+↑/↓ 切会话, Esc 关检查栏 (输入框里的 Esc 先给输入框)
function useChatKeys(channel: string | null, closePane: () => void): void {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        const list = chats.ordered();
        if (!list.length) return;
        e.preventDefault();
        const i = list.findIndex((c) => c.channel === channel);
        const j = i < 0 ? 0 : (i + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length;
        return nav("chat", list[j]!.channel);
      }
      if (e.key === "Escape" && !e.defaultPrevented) closePane();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [channel, closePane]);
}
