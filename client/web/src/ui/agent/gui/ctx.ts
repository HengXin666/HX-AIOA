import { createContext, useContext } from "react";
import type { HostConn } from "../../../agentgui/conn";

export type RightTab = "changes" | "files" | "plan";
// 工作台里各块共用: 当前主机与会话, 在右栏打开某个文件, 往输入框插字
export type GuiCtx = {
  host: string;
  sid: string;
  conn: HostConn;
  openRight: (tab: RightTab, path?: string) => void;
  insert: (text: string) => void;
};

export const Ctx = createContext<GuiCtx | null>(null);

export function useGui(): GuiCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("工作台上下文缺失");
  return v;
}
