import { PLUGIN_VAR_BASE, PLUGIN_VAR_CHANNEL, PLUGIN_VAR_TITLE, type PluginInstall } from "@hx-aioa/protocol";
import { todoGuide } from "./todo-guide";

type Row = { id: string; body: string };
type Saved = { install: PluginInstall; prompt: string; name: string };

/** 已安装的插件: 一行一个, 带安装时拉到的提示词模板, 生成专属指令时不用再联网。 */
export class PluginStore {
  private cache: Map<string, Saved> | null = null;

  constructor(private readonly sql: SqlStorage) {
    sql.exec("CREATE TABLE IF NOT EXISTS plugin (id TEXT PRIMARY KEY, body TEXT NOT NULL)");
  }

  private all(): Map<string, Saved> {
    this.cache ??= new Map(this.sql.exec<Row>("SELECT id, body FROM plugin").toArray().map((r) => [r.id, JSON.parse(r.body) as Saved]));
    return this.cache;
  }

  list(): PluginInstall[] {
    return [...this.all().values()].map((s) => s.install);
  }

  get(id: string): PluginInstall | null {
    return this.all().get(id)?.install ?? null;
  }

  save(install: PluginInstall, name: string, prompt: string): void {
    const saved: Saved = { install, prompt, name };
    this.sql.exec("INSERT OR REPLACE INTO plugin (id, body) VALUES (?, ?)", install.id, JSON.stringify(saved));
    this.all().set(install.id, saved);
  }

  remove(id: string): void {
    this.sql.exec("DELETE FROM plugin WHERE id = ?", id);
    this.all().delete(id);
  }

  /** 专属指令里的 "插件任务" 一节: 模板替换占位符, 再附上待办接口。 */
  promptFor(id: string, base: string, channel: string, title: string): string | undefined {
    const s = this.all().get(id);
    return s ? renderTask(s.name, s.prompt, base, channel, title) : undefined;
  }
}

/** 插件模板代入群和地址, 拼上服务端生成的待办接口说明。 */
export function renderTask(name: string, prompt: string, base: string, channel: string, title: string): string {
  const body = prompt.replaceAll(PLUGIN_VAR_CHANNEL, channel).replaceAll(PLUGIN_VAR_TITLE, title).replaceAll(PLUGIN_VAR_BASE, base).trim();
  return [`## 插件任务: ${name}`, "", body, "", todoGuide(base, channel)].join("\n");
}
