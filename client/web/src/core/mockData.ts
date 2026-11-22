import type { Envelope, Priority, Space, TaskLogEntry, TaskSnapshot } from "@hx-aioa/protocol";
import { ANY, FIELD_EVENTS, FIELD_REPORT } from "../constants";

const MIN = 60_000;
const NAS = "nas-01";
const VPS = "vps-1";
const ROUTER = "router";
const GPU = "gpu-01";
const BACKUP = "backup";
const HOME = "home";
const GITHUB = "github";
const DSH = "dsh";
const R10 = "10m";
const R5 = "5m";
const PUSH = { mode: "push" } as const;

export const MOCK_SUBJECTS = { NAS, VPS, ROUTER, GPU, BACKUP, HOME, GITHUB };

export const MOCK_SPACES: Space[] = [
  {
    id: "servers",
    title: "服务器",
    icon: "server",
    origin: "manual",
    panels: [
      {
        id: "nas",
        title: "群晖 NAS",
        icon: "hard-drive",
        refresh: PUSH,
        items: [
          { id: "nas-cpu-ring", type: "ring", title: "CPU", bind: [{ subject: NAS, field: "cpu" }], props: { warn: 70, crit: 90 } },
          { id: "nas-mem-ring", type: "ring", title: "内存", bind: [{ subject: NAS, field: "mem" }] },
          { id: "nas-temp", type: "value", title: "温度", icon: "thermometer", bind: [{ subject: NAS, field: "temp", range: R10 }] },
          { id: "nas-cpu-line", type: "line", title: "CPU 走势", icon: "cpu", bind: [{ subject: NAS, field: "cpu", range: R10 }], props: { warn: 70, crit: 90 } },
        ],
      },
      {
        id: "vps",
        title: "VPS-1",
        icon: "server",
        refresh: PUSH,
        items: [
          { id: "vps-cpu", type: "sparkline", title: "CPU", icon: "cpu", bind: [{ subject: VPS, field: "cpu", range: R5 }] },
          { id: "vps-mem", type: "sparkline", title: "内存", icon: "memory-stick", bind: [{ subject: VPS, field: "mem", range: R5 }] },
          { id: "vps-net", type: "line", title: "出站流量", icon: "activity", bind: [{ subject: VPS, field: "net", range: R10 }], props: { threshold: false } },
        ],
      },
      {
        id: "health",
        title: "在线状态",
        icon: "wifi",
        refresh: PUSH,
        items: [
          {
            id: "up-grid",
            type: "status_grid",
            bind: [NAS, VPS, ROUTER, GPU].map((subject) => ({ subject, field: "up" })),
            props: { labels: ["NAS", "VPS", "路由器", "GPU 机"] },
          },
          { id: "router-cpu", type: "value", title: "路由器 CPU", bind: [{ subject: ROUTER, field: "cpu" }] },
          { id: "gpu-temp", type: "value", title: "GPU 温度", bind: [{ subject: GPU, field: "temp" }] },
        ],
      },
      {
        id: "backup",
        title: "备份",
        icon: "database",
        refresh: { mode: "interval", everySec: 60 },
        items: [
          { id: "backup-size", type: "value", title: "最近一次备份", bind: [{ subject: BACKUP, field: "size" }] },
          { id: "backup-ev", type: "list", title: "备份记录", bind: [{ subject: BACKUP, field: FIELD_EVENTS }], props: { limit: 2 } },
        ],
      },
      {
        id: "ops",
        title: "操作",
        icon: "play",
        refresh: PUSH,
        items: [
          { id: "restart", type: "button", title: "重启 web 容器", icon: "rotate-ccw", action: { agent: DSH, command: "restart", args: { name: "web" }, danger: true } },
          { id: "prune", type: "button", title: "清理镜像缓存", icon: "trash", action: { agent: DSH, command: "prune" } },
        ],
      },
    ],
  },
  {
    id: "dev",
    title: "开发",
    icon: "git-branch",
    origin: "agent:dsh",
    panels: [
      { id: "tasks", title: "Agent 任务", icon: "bot", refresh: PUSH, items: [{ id: "task-all", type: "task_card", props: { limit: 2 } }] },
      { id: "gh", title: "GitHub 动态", icon: "git-branch", refresh: PUSH, items: [{ id: "gh-list", type: "list", bind: [{ subject: GITHUB, field: FIELD_EVENTS }] }] },
      { id: "daily", title: "AI 日报", icon: "sparkles", size: "l", refresh: PUSH, items: [{ id: "daily-r", type: "report", bind: [{ subject: ANY, field: FIELD_REPORT }] }] },
    ],
  },
  {
    id: "home",
    title: "家庭",
    icon: "house",
    panels: [
      {
        id: "climate",
        title: "客厅",
        icon: "thermometer",
        refresh: PUSH,
        items: [
          { id: "home-temp", type: "sparkline", title: "温度", bind: [{ subject: HOME, field: "temp", range: R10 }] },
          { id: "home-hum", type: "ring", title: "湿度", bind: [{ subject: HOME, field: "humidity" }] },
        ],
      },
    ],
  },
];

export const ERROR_BIND = { subject: ROUTER, field: "cpu", text: "Beszel 认证失败" };

let seq = 0;
const src = (name: string, icon: string) => ({ id: `src_${icon}`, name, icon });

function ev(kind: "event" | "report", priority: Priority, subject: string | undefined, ago: number, data: Record<string, unknown>, more: Partial<Envelope> = {}): Envelope {
  const source = subject === GITHUB ? src("GitHub", "git-branch") : kind === "report" ? src("DSH 日报", "sparkles") : src("群晖 NAS", "server");
  return { id: `e_${++seq}`, seq, ts: Date.now() - ago, kind, source, subject, priority, data, ...more } as Envelope;
}

const FEED = { source: src("订阅", "rss") };

export function mockEvents(): Envelope[] {
  return [
    ev("event", "need_me", NAS, 4 * MIN, { title: "磁盘 sda 出现坏道", summary: "SMART 重分配扇区 12 个, 建议尽快备份并更换。", severity: "critical", status: "firing" }),
    ev("event", "need_me", undefined, 30 * MIN, { title: "张三在 PR #18 请你评审", summary: "协议 v1: 统一事件模型", severity: "warning" }, { source: src("GitHub", "git-branch") }),
    ev("event", "happening", GITHUB, 8 * MIN, { title: "HX-AIOA 推送 5 次提交", summary: "core-proto 分支: 协议 v1 草案, 服务端规则引擎", severity: "normal" }, { groupKey: "gh-push" }),
    ev("event", "happening", GITHUB, 25 * MIN, { title: "Actions: Android 构建成功", summary: "APK 已上传为构建产物", severity: "normal" }),
    ev("event", "happening", BACKUP, 6 * MIN, { title: "夜间备份完成", summary: "增量 2.4 GB, 耗时 11 分钟", severity: "normal" }),
    ev("event", "happening", VPS, 40 * MIN, { title: "VPS-1 部署 v0.8.2", summary: "滚动更新 3/3 实例", severity: "normal" }),
    ev("report", "worth_reading", undefined, 2 * 60 * MIN, {
      title: "今日 AI 日报",
      period: "今天 08:00",
      summary: "昨天 50 条 GitHub 动态归纳为 5 条; NAS 温度稳定; 有一个依赖安全更新值得关注。",
      markdown: "## 要点\n- **协议 v1** 草案已合入 core-proto\n- NAS 平均温度 41°C, 比上周低 2°C\n- `vite` 有一个中危安全更新\n\n## 建议\n> 本周安排一次磁盘更换, 避免坏道扩大。\n\n原始动态可在 [GitHub](https://github.com/HengXin666/HX-AIOA) 追溯。",
      refs: ["e_3", "e_4"],
    }),
    ev("report", "worth_reading", undefined, 26 * 60 * MIN, { title: "本周资源周报", period: "第 47 周", summary: "CPU 峰值出现在周三备份时段, 内存占用平稳。", markdown: "## 本周\n- CPU 峰值 87%, 周三 03:00\n- 出站流量合计 41 GB" }),
    ev("event", "worth_reading", undefined, 3 * 60 * MIN, { title: "Cloudflare 发布 Durable Objects 新计费说明", summary: "SQLite 存储写入额度调整, 与本项目免费额度相关。", severity: "info", url: "https://developers.cloudflare.com/durable-objects/" }, FEED),
    ev("event", "worth_reading", undefined, 5 * 60 * MIN, { title: "兴趣发现: Compose Multiplatform 1.8 热重载", summary: "桌面画廊方案可直接使用。", severity: "info" }, FEED),
    ev("event", "worth_reading", undefined, 7 * 60 * MIN, { title: "关注的仓库 lucide 发布新版本", summary: "新增 40 个图标。", severity: "info" }, FEED),
    ev("event", "worth_reading", undefined, 9 * 60 * MIN, { title: "AI 专题: 个人消息聚合的三种架构", summary: "推送, 拉取与混合模式的耗电对比。", severity: "info" }, FEED),
  ];
}

export function backupEvent(): Envelope {
  return ev("event", "happening", BACKUP, 5 * MIN, { title: "备份上传到 OSS", summary: "校验通过", severity: "normal" });
}

export function randomEvent(): Envelope {
  const titles = ["GitHub: 新 issue #21", "Actions: Web 构建成功", "依赖机器人提交 PR", "张三 star 了仓库"];
  return ev("event", "happening", GITHUB, 0, { title: titles[seq % titles.length]!, severity: "normal" }, { groupKey: "gh" });
}

export function mockTasks(now = Date.now()): { task: TaskSnapshot; log: TaskLogEntry[] }[] {
  const t = (task: Omit<TaskSnapshot, "created" | "updated" | "agent">, ago: number): TaskSnapshot => ({ agent: DSH, created: now - ago, updated: now - ago / 4, ...task });
  return [
    {
      task: t({ id: "deploy-42", title: "部署到生产", state: "waiting", step: "等待切换流量", subject: VPS, prompt: { id: "p_1", question: "新版本健康检查通过, 切换生产流量?", options: [{ id: "go", label: "切换", style: "danger" }, { id: "hold", label: "先不" }], allowText: true, danger: true } }, 20 * MIN),
      log: [
        { ts: now - 20 * MIN, role: "user", kind: "create", text: "把 v0.8.3 部署到生产" },
        { ts: now - 18 * MIN, role: "agent", kind: "say", text: "好的, 先构建镜像并在灰度环境跑健康检查。" },
        { ts: now - 9 * MIN, role: "system", kind: "progress", text: "构建镜像完成" },
        { ts: now - 5 * MIN, role: "agent", kind: "wait", text: "新版本健康检查通过, 切换生产流量?" },
      ],
    },
    {
      task: t({ id: "research-7", title: "整理本周 GitHub 动态", state: "running", progress: 0.35, step: "读取 50 条事件" }, 12 * MIN),
      log: [
        { ts: now - 12 * MIN, role: "user", kind: "create", text: "帮我把本周关注仓库的动态整理成 5 条" },
        { ts: now - 11 * MIN, role: "agent", kind: "say", text: "开始拉取事件, 预计 3 分钟。" },
      ],
    },
    {
      task: t({ id: "clean-3", title: "清理旧日志", state: "done", result: "释放 3.1 GB" }, 3 * 60 * MIN),
      log: [{ ts: now - 3 * 60 * MIN, role: "agent", kind: "done", text: "释放 3.1 GB" }],
    },
  ];
}
