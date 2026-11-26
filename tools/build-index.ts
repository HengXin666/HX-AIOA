// 生成聚合索引: 把每个插件的 plugin.json 内嵌进 index.json, 服务端看列表和详情只拉一次索引
// 用法: node --import tsx tools/build-index.ts [市场目录]; 改了清单后跑一次再提交, CI 检查是否同步
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PLUGIN_INDEX_FILE, PLUGIN_MANIFEST_FILE } from "@hx-aioa/protocol";

const root = process.argv[2] ?? "plugins";
const file = join(root, PLUGIN_INDEX_FILE);
const index = JSON.parse(readFileSync(file, "utf8")) as { plugins: Record<string, unknown>[] };
for (const e of index.plugins) {
  const m = JSON.parse(readFileSync(join(root, String(e.id), PLUGIN_MANIFEST_FILE), "utf8")) as Record<string, unknown>;
  e.version = m.version;
  e.manifest = m;
}
writeFileSync(file, `${JSON.stringify(index, null, 2)}\n`);
console.log(`已内嵌 ${index.plugins.length} 个清单到 ${file}`);
