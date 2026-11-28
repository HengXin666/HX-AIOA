import { createContext, useContext } from "react";
import type { HostConn } from "../../../agentgui/conn";
import type { Emitter } from "../../../core/emitter";
import type { Command } from "../../../agentgui/keybindings";

export type RightTab = "changes" | "files" | "plan";
// 工作台里各块共用: 当前主机与会话, 在右栏打开某个文件, 往输入框插字
export type GuiCtx = {
  host: string;
  sid: string;
  conn: HostConn;
  openRight: (tab: RightTab, path?: string) => void;
  insert: (text: string) => void;
  // 快捷键与命令面板发出的命令, 会话页与输入框各自认领
  cmd: Emitter<Command>;
  toggleSidebar: () => void;
};

export const Ctx = createContext<GuiCtx | null>(null);

export function useGui(): GuiCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("工作台上下文缺失");
  return v;
}
