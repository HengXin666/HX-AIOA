import type { ItemType } from "./constants";
import type { ExtPoint } from "./plugin-v2";

// 客户端能力表 (#156): 每个端从哪个构建号起支持哪些工作台组件, 扩展点, 权限; 市场 CI 与服务端拉源用同一张表校验插件。
// 构建号: 安卓 = versionCode = android.yml 的 GITHUB_RUN_NUMBER = Release 标签 android-N 的 N; Web = deploy.yml 的 GITHUB_RUN_NUMBER (version.json 的 web)。
// 维护: 客户端新增或接上一种组件, 扩展点, 权限时, 同一 PR 在这里登记 "从哪个构建号起" (合并后那次 Release / 部署的号),
// 安卓附画廊截图, Web 附截图测试; 只登记真实可用的, 没接的不写。known 是已发布的最大构建号, CI 离线时用它判断 "不能写未来版本"。
export const CLIENT_KINDS = ["android", "web"] as const;
export type ClientKind = (typeof CLIENT_KINDS)[number];
// 只依赖服务端与 Agent, 没有界面贡献的插件写 ["*"]
export const CLIENT_ANY = "*";
export type ClientDecl = ClientKind | typeof CLIENT_ANY;
// 没写 clients 的存量插件都是按安卓做的
export const DEFAULT_CLIENTS: readonly ClientDecl[] = ["android"];
export const isClientKind = (v: unknown): v is ClientKind => (CLIENT_KINDS as readonly unknown[]).includes(v);

// 握手: /api/v1/stream, /api/v1/compat, 插件列表与贡献接口上带 client=android|web&cb=<构建号>
export const QUERY_CLIENT = "client";
export const QUERY_CLIENT_BUILD = "cb";
export type ClientRef = { kind: ClientKind; build?: number };
const MAX_BUILD = 1e9;
export const isBuild = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1 && (v as number) < MAX_BUILD;

/** 读查询参数里的端与构建号; 端不认识就当没给, 构建号不对只丢构建号。 */
export function parseClient(kind: string | null, cb: string | null): ClientRef | undefined {
  if (!isClientKind(kind)) return undefined;
  const n = cb && /^\d{1,9}$/.test(cb) ? Number(cb) : Number.NaN;
  return isBuild(n) ? { kind, build: n } : { kind };
}

// 只有客户端渲染的扩展点与权限要看端; 其余 (数据集合, 推送管线, 消息管线) 在服务端执行, 与端无关
export const CLIENT_POINTS: readonly ExtPoint[] = ["commands", "widgets", "settings", "core.theme.base", "core.chat.renderer"];
export const CLIENT_PERMS: readonly string[] = ["ui.webview"];

export type ClientCaps = {
  // 已发布的最大构建号
  known: number;
  // 能渲染插件工作台 (space) 的最低构建号; 没有就是还不支持
  space?: number;
  items: Partial<Record<ItemType, number>>;
  points: Partial<Record<ExtPoint, number>>;
  perms: Record<string, number>;
  // 客户端手写了这个插件的界面 (不走通用渲染): 它在 CLIENT_POINTS 上的贡献从该构建号起算支持
  native: Record<string, number>;
};

const SPACE_SINCE = 17;
export const CLIENT_CAPS: Record<ClientKind, ClientCaps> = {
  // 安卓: 工作台全部组件 android-17 (#16), todo 组件 android-85, 主题插件 android-125 (令牌与 kit/Tokens.kt 的 AioaColors 同名);
  // GitHub 接入的卡片与同步命令是手写页面, 跟插件启用走从 android-121 起; ui.webview 插槽还没做
  android: {
    known: 154,
    space: SPACE_SINCE,
    items: {
      value: SPACE_SINCE,
      sparkline: SPACE_SINCE,
      line: SPACE_SINCE,
      ring: SPACE_SINCE,
      status_grid: SPACE_SINCE,
      task_card: SPACE_SINCE,
      list: SPACE_SINCE,
      report: SPACE_SINCE,
      button: SPACE_SINCE,
      chat: SPACE_SINCE,
      approval: SPACE_SINCE,
      todo: 85,
    },
    points: { "core.theme.base": 125 },
    perms: {},
    native: { "hengxin666.github": 121 },
  },
  // Web (React 版, W1): 目前只有聊天, 工作台, 扩展点, 主题都没接; 接上后在这里登记, ui.webview 在 Web 上是沙箱 iframe
  web: { known: 105, items: {}, points: {}, perms: {}, native: {} },
};
