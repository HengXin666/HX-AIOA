import type { ButtonAction, UserActionInput } from "@hx-aioa/protocol";
import { TXT_CONFIRM_DANGER } from "../constants";
import { uid } from "./dom";
import type { Store } from "./store";

export type ActInput = Omit<UserActionInput, "aid">;
export type Mode = "mock" | "live" | "none";

// 页面与组件只认这个接口, 真实流与 mock 各自实现
export interface Backend {
  readonly mode: Mode;
  sendAct(input: UserActionInput): boolean;
  watch(subjects: string[]): void;
}

const ACT_LABEL: Record<UserActionInput["kind"], string> = {
  approve: "同意",
  reject: "拒绝",
  reply: "回复",
  cancel: "取消任务",
  ask: "追问",
};

export class Actions {
  constructor(
    private readonly store: Store,
    private backend: Backend,
  ) {}

  get mode(): Mode {
    return this.backend.mode;
  }

  setBackend(b: Backend): void {
    this.backend = b;
  }

  watch(subjects: string[]): void {
    this.backend.watch(subjects);
  }

  act(input: ActInput, danger = false): boolean {
    if (danger && !window.confirm(TXT_CONFIRM_DANGER)) return false;
    const full: UserActionInput = { aid: uid("a"), ...input };
    if (danger) full.confirm = true;
    const ok = this.backend.sendAct(full);
    if (ok) {
      const text = input.text ?? input.option ?? "";
      this.store.appendLog(input.taskId, {
        ts: Date.now(),
        role: "user",
        kind: input.kind,
        text: text ? `${ACT_LABEL[input.kind]}: ${text}` : ACT_LABEL[input.kind],
      });
    }
    return ok;
  }

  button(spaceId: string, itemId: string, a: ButtonAction): boolean {
    return this.act({ taskId: `button:${spaceId}:${itemId}`, kind: "reply", text: a.command }, a.danger === true);
  }
}
