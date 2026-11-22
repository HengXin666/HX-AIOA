import { parseRule, parseWindow, type Rule, type Settings } from "@hx-aioa/protocol";
import { randomId } from "./auth";
import { DEFAULT_TZ, KV_RULES, KV_SETTINGS, MAX_SETTING_BYTES, MAX_SETTING_KEYS, MAX_USER_RULES } from "./constants";
import { isValidTz } from "./rules/window";

// 用户规则与设置: 各存一个 KV 键, 改一次只写一行; 读多写少, 常驻内存
export class Config {
  private rulesCache: Rule[] | null = null;
  private settingsCache: Settings | null = null;

  constructor(private readonly storage: DurableObjectStorage) {}

  async rules(): Promise<Rule[]> {
    this.rulesCache ??= (await this.storage.get<Rule[]>(KV_RULES)) ?? [];
    return this.rulesCache;
  }

  private async saveRules(rules: Rule[]): Promise<void> {
    this.rulesCache = rules;
    await this.storage.put(KV_RULES, rules);
  }

  async addRule(raw: unknown): Promise<Rule | string> {
    const input = parseRule(raw);
    if (typeof input === "string") return input;
    const rules = await this.rules();
    if (rules.length >= MAX_USER_RULES) return `规则最多 ${MAX_USER_RULES} 条`;
    const rule: Rule = { ...input, id: randomId("r_", 4) };
    await this.saveRules([...rules, rule]);
    return rule;
  }

  async replaceRule(id: string, raw: unknown): Promise<Rule | string | null> {
    const input = parseRule(raw);
    if (typeof input === "string") return input;
    const rules = await this.rules();
    const i = rules.findIndex((r) => r.id === id);
    if (i < 0) return null;
    const rule: Rule = { ...input, id };
    await this.saveRules(rules.map((r, j) => (j === i ? rule : r)));
    return rule;
  }

  async deleteRule(id: string): Promise<boolean> {
    const rules = await this.rules();
    const next = rules.filter((r) => r.id !== id);
    if (next.length === rules.length) return false;
    await this.saveRules(next);
    return true;
  }

  async reorder(ids: string[]): Promise<Rule[] | string> {
    const rules = await this.rules();
    if (ids.length !== rules.length || !rules.every((r) => ids.includes(r.id))) return "ids 必须包含全部自定义规则 id";
    const next = ids.map((id) => rules.find((r) => r.id === id) as Rule);
    await this.saveRules(next);
    return next;
  }

  async settings(): Promise<Settings> {
    this.settingsCache ??= (await this.storage.get<Settings>(KV_SETTINGS)) ?? {};
    return this.settingsCache;
  }

  async tz(): Promise<string> {
    const tz = (await this.settings()).tz;
    return typeof tz === "string" && isValidTz(tz) ? tz : DEFAULT_TZ;
  }

  // 逐键合并, null 删除; 只校验服务端识别的键
  async patchSettings(raw: unknown): Promise<Settings | string> {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return "设置必须是对象";
    const next: Settings = { ...(await this.settings()) };
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (v === null) {
        delete next[k];
        continue;
      }
      if (JSON.stringify(v).length > MAX_SETTING_BYTES) return `${k} 过大`;
      if (k === "tz" && !(typeof v === "string" && isValidTz(v))) return "tz 必须是 IANA 时区";
      if (k === "quiet") {
        const w = parseWindow(v);
        if (typeof w === "string") return `quiet: ${w}`;
      }
      if (k === "wxpusherUid" && typeof v !== "string") return "wxpusherUid 必须是字符串";
      next[k] = v;
    }
    if (Object.keys(next).length > MAX_SETTING_KEYS) return `设置最多 ${MAX_SETTING_KEYS} 个键`;
    this.settingsCache = next;
    await this.storage.put(KV_SETTINGS, next);
    return next;
  }
}
