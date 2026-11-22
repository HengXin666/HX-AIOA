import { BUTTON_TASK_PREFIX, validateSpace, type ButtonAction, type Space, type SpaceState, type SpaceWithState } from "@hx-aioa/protocol";
import { KV_SPACES } from "./constants";

const MAX_SPACES = 12;
type Stored = Record<string, SpaceWithState>;

// 全部工作台存一个 KV 键: 布局很少变, 改一次只写一行
export class Spaces {
  private cache: Stored | null = null;

  constructor(private readonly storage: DurableObjectStorage) {}

  private async all(): Promise<Stored> {
    this.cache ??= (await this.storage.get<Stored>(KV_SPACES)) ?? {};
    return this.cache;
  }

  private async save(next: Stored): Promise<void> {
    this.cache = next;
    await this.storage.put(KV_SPACES, next);
  }

  async list(): Promise<SpaceWithState[]> {
    return Object.values(await this.all());
  }

  // 同 id 覆盖布局, 保留用户自己的显示状态
  async put(raw: unknown, origin: string): Promise<{ space: SpaceWithState } | { errors: string[] }> {
    const errs = validateSpace(raw);
    if (errs.length) return { errors: errs };
    const all = await this.all();
    const s = raw as Space;
    if (!all[s.id] && Object.keys(all).length >= MAX_SPACES) return { errors: [`工作台最多 ${MAX_SPACES} 个`] };
    const space: SpaceWithState = { ...s, origin: s.origin ?? origin, updated: Date.now(), state: all[s.id]?.state ?? {} };
    await this.save({ ...all, [s.id]: space });
    return { space };
  }

  async remove(id: string): Promise<boolean> {
    const all = await this.all();
    if (!all[id]) return false;
    const { [id]: _gone, ...rest } = all;
    await this.save(rest);
    return true;
  }

  async setState(id: string, raw: unknown): Promise<SpaceWithState | string | null> {
    const all = await this.all();
    const cur = all[id];
    if (!cur) return null;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return "state 必须是对象";
    const r = raw as Record<string, unknown>;
    const strs = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === "string");
    const state: SpaceState = { ...cur.state };
    if (r.hidden !== undefined) {
      if (typeof r.hidden !== "boolean") return "hidden 必须是布尔值";
      state.hidden = r.hidden;
    }
    if (r.hiddenPanels !== undefined) {
      if (!strs(r.hiddenPanels)) return "hiddenPanels 必须是字符串数组";
      state.hiddenPanels = r.hiddenPanels as string[];
    }
    if (r.order !== undefined) {
      if (!strs(r.order)) return "order 必须是字符串数组";
      state.order = r.order as string[];
    }
    const next = { ...cur, state };
    await this.save({ ...all, [id]: next });
    return next;
  }

  // button:<spaceId>:<itemId> → 该按钮声明的 Agent 动作
  async button(taskId: string): Promise<ButtonAction | null> {
    if (!taskId.startsWith(BUTTON_TASK_PREFIX)) return null;
    const [spaceId, itemId] = taskId.slice(BUTTON_TASK_PREFIX.length).split(":");
    const space = (await this.all())[spaceId ?? ""];
    for (const p of space?.panels ?? []) for (const it of p.items) if (it.id === itemId && it.type === "button" && it.action) return it.action;
    return null;
  }
}
