import type { Env } from "./env";
import { rest } from "./api-cf-storage";

// R2 桶 / KV 命名空间 / D1 库不属于某个 worker, 按各 worker 的绑定对回去; 见 docs/deploy/cf-usage.md
type Binding = { type: string; bucket_name?: string; namespace_id?: string; id?: string; database_id?: string };
const UNBOUND = "未绑定";

export const ownerKey = (kind: "r2" | "kv" | "d1", id: string) => `${kind}:${id}`;

/** 资源 -> 绑定它的 worker (多个用 + 连); 列不出脚本时返回空表。 */
export async function storeOwners(env: Env): Promise<Map<string, string>> {
  const a = env.CF_ACCOUNT_ID!;
  const scripts = await rest<{ id: string }[]>(env, `/accounts/${a}/workers/scripts`).catch(() => [] as { id: string }[]);
  const lists = await Promise.all(
    scripts.map((s) =>
      rest<{ bindings?: Binding[] }>(env, `/accounts/${a}/workers/scripts/${encodeURIComponent(s.id)}/settings`)
        .then((r) => ({ name: s.id, bindings: r.bindings ?? [] }))
        .catch(() => ({ name: s.id, bindings: [] as Binding[] })),
    ),
  );
  const out = new Map<string, string[]>();
  const put = (k: string, w: string) => out.set(k, [...new Set([...(out.get(k) ?? []), w])]);
  for (const { name, bindings } of lists) {
    for (const b of bindings) {
      if (b.type === "r2_bucket" && b.bucket_name) put(ownerKey("r2", b.bucket_name), name);
      else if (b.type === "kv_namespace" && b.namespace_id) put(ownerKey("kv", b.namespace_id), name);
      else if (b.type === "d1") put(ownerKey("d1", b.database_id ?? b.id ?? ""), name);
    }
  }
  return new Map([...out].map(([k, v]) => [k, v.join(" + ")]));
}

/** 按 worker 累加各额度项的用量。 */
export class Split {
  private m = new Map<string, Map<string, number>>();
  constructor(private owners: Map<string, string>) {}
  owner(key: string): string {
    return this.owners.get(key) ?? UNBOUND;
  }
  add(quota: string, key: string, v: number): void {
    if (!v) return;
    const w = this.owner(key);
    const q = this.m.get(quota) ?? new Map<string, number>();
    q.set(w, (q.get(w) ?? 0) + v);
    this.m.set(quota, q);
  }
  by(quota: string): { name: string; used: number }[] | undefined {
    const q = this.m.get(quota);
    if (!q?.size) return undefined;
    return [...q].map(([name, used]) => ({ name, used: Math.round(used) })).sort((x, y) => y.used - x.used);
  }
}
