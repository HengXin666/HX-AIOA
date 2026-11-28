import { CLIENT_ANY, CLIENT_CAPS, CLIENT_KINDS, type ClientKind } from "./client-caps";
import { parseManifest, type PluginManifest } from "./plugin";
import { buildFloor, clientsOf, kindsOf, missingCaps, needLabel, uiNeeds } from "./plugin-clients";

// 一份清单的完整校验 (#156): 市场 CI (tools/check-plugins.ts) 与服务端拉市场源 (官方, 第三方, 私有, #118) 共用这一个入口
// released: 某端某构建号是否真实发布过; 返回 undefined 表示查不到 (离线), 退回能力表的 known 判断并给警告
export type Released = (kind: ClientKind, build: number) => boolean | undefined;
export type ManifestCheckOptions = {
  // 新增或升版本的插件: 必须写 clients 与每个端的 engines.<端>
  strict?: boolean;
  // 不给就不查构建号是否发布过 (服务端拉源时不查, 免得部署的能力表比客户端旧时误拒)
  released?: Released;
};
export type ManifestCheck = { manifest?: PluginManifest; errors: string[]; warns: string[] };

/** 校验清单格式, 端声明, 能力表与构建号; 有 errors 就不能进市场。 */
export function checkManifest(raw: unknown, opts: ManifestCheckOptions = {}): ManifestCheck {
  const m = parseManifest(raw);
  if (typeof m === "string") return { errors: [m], warns: [] };
  const errors: string[] = [];
  const warns: string[] = [];
  if (opts.strict && m.clients === undefined) errors.push(`新增或升版本的插件必须写 clients (${CLIENT_KINDS.join(" / ")}, 没有界面写 ["${CLIENT_ANY}"])`);
  if (clientsOf(m).includes(CLIENT_ANY)) {
    const ui = new Set(CLIENT_KINDS.flatMap((k) => uiNeeds(m, k).map(needLabel)));
    if (ui.size) errors.push(`clients 写了 "${CLIENT_ANY}" 但有界面贡献: ${[...ui].join(", ")}`);
  }
  for (const k of CLIENT_KINDS) {
    if (kindsOf(m).includes(k)) continue;
    if (m.engines?.[k] !== undefined) warns.push(`写了 engines.${k} 但 clients 里没有 ${k}`);
    if (m.builtWith?.[k] !== undefined) warns.push(`写了 builtWith.${k} 但 clients 里没有 ${k}`);
  }
  for (const k of kindsOf(m)) {
    const range = m.engines?.[k];
    if (!range) {
      (opts.strict ? errors : warns).push(`声明了 ${k} 但没写 engines.${k} (最低构建号)`);
      continue;
    }
    const floor = buildFloor(range);
    if (floor < 1) {
      errors.push(`engines.${k} 要写下界, 如 ">=${CLIENT_CAPS[k].known}"`);
      continue;
    }
    const miss = missingCaps(m, k, floor);
    if (miss.length) errors.push(`${k} 构建号 ${floor} 不支持: ${miss.map(needLabel).join(", ")}`);
    const built = m.builtWith?.[k];
    if (built !== undefined && built < floor) warns.push(`builtWith.${k} = ${built} 低于最低构建号 ${floor}`);
    if (built === undefined && opts.strict) warns.push(`建议写 builtWith.${k} (开发验证时用的构建号)`);
    if (!opts.released) continue;
    const ok = opts.released(k, floor);
    if (ok === false) errors.push(`engines.${k} 的最低构建号 ${floor} 没有发布过`);
    else if (ok === undefined && floor > CLIENT_CAPS[k].known) errors.push(`engines.${k} 的最低构建号 ${floor} 超过能力表已知的最大构建号 ${CLIENT_CAPS[k].known}, 不能写未来版本`);
    else if (ok === undefined) warns.push(`查不到 ${k} 的发布记录 (离线), 只按能力表已知最大构建号 ${CLIENT_CAPS[k].known} 检查了 ${floor}`);
  }
  return { manifest: m, errors, warns };
}

const CELL = { ok: "支持", missing: "缺能力", none: "不支持", undeclared: "未写构建号" } as const;

/** 插件 × 端矩阵的一格: 支持 (≥N) / 缺能力 / 不支持 / 未写构建号。 */
export function matrixCell(m: PluginManifest, k: ClientKind): string {
  if (clientsOf(m).includes(CLIENT_ANY)) return `${CELL.ok} (无界面)`;
  if (!kindsOf(m).includes(k)) return CELL.none;
  const range = m.engines?.[k];
  if (!range) return CELL.undeclared;
  const floor = buildFloor(range);
  return missingCaps(m, k, floor).length ? CELL.missing : `${CELL.ok} (≥${floor})`;
}
