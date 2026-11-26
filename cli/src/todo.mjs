// 待办: 走插件数据接口 (pdata, hengxin666.todo/items), 行 id 为 <群>:<待办 id>, 写入带读到的 ver, 冲突时打印当前行
import { ApiError, call, enc } from "./http.mjs";
import { PATH_TODO_ITEMS, todoRowId } from "./proto.mjs";

export const EXIT_CONFLICT = 3;
const STATE_LABEL = { open: "待进行", hold: "挂起", doing: "进行中", done: "已完成", dropped: "已完成" };
const DEFAULT_PRIO = 2;
// 同一条消息拆多条时 id 加 -2, -3 ...
const MAX_SPLIT = 9;
const TEXT_FIELDS = ["title", "note", "repo", "parent", "state", "area"];
const NUM_FIELDS = ["prio", "issue", "src", "remind"];
const NOTE_PREVIEW = 80;
// 计划字段 (#105): 截止按东八区写, 周期写 month / 2week / none
const TZ_MIN = 480;
const MIN_MS = 60_000;
const EVERY_UNITS = { day: "天", week: "周", month: "个月", year: "年" };
const FLAG_FIELDS = ["star", "alarm"];

const localTime = (ts) => new Date(ts + TZ_MIN * MIN_MS).toISOString().slice(5, 16).replace("T", " ");

/** 一行一条: [状态] P优先级 id 标题 ★ {分区} 截止 .. 每月 (repo#issue) <- 父 | note */
export function todoLine(t) {
  const issue = t.repo && t.issue ? ` (${t.repo}#${t.issue})` : "";
  const parent = t.parent ? ` <- ${t.parent}` : "";
  const note = t.note ? ` | ${t.note.replace(/\s+/g, " ").slice(0, NOTE_PREVIEW)}` : "";
  const due = t.due ? ` 截止 ${localTime(t.due)}${t.remind != null ? ` 提前${t.remind}分提醒` : ""}` : "";
  const every = t.every ? ` 每${t.every.n === 1 ? "" : t.every.n}${EVERY_UNITS[t.every.unit] ?? t.every.unit}` : "";
  const plan = `${t.star ? " ★" : ""}${t.area ? ` {${t.area}}` : ""}${due}${every}`;
  return `[${STATE_LABEL[t.state] ?? t.state}] P${t.prio ?? DEFAULT_PRIO} ${t.id} ${t.title}${plan}${issue}${parent}${note}`;
}

/** --due: "2026-11-30 18:00" / "11-30 18:00" / "11-30" (东八区, 不写时间为 23:59) 或毫秒时间戳。 */
export function parseDue(v, now = Date.now()) {
  if (/^\d{12,}$/.test(v)) return Number(v);
  const m = /^(?:(\d{4})-)?(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(v.trim());
  if (!m) throw new ApiError(0, "--due 写成 2026-11-30 18:00 或 11-30 18:00");
  const year = m[1] ? Number(m[1]) : new Date(now + TZ_MIN * MIN_MS).getUTCFullYear();
  const [h, mi] = m[4] ? [Number(m[4]), Number(m[5])] : [23, 59];
  return Date.UTC(year, Number(m[2]) - 1, Number(m[3]), h, mi) - TZ_MIN * MIN_MS;
}

/** --every: day / week / month / year, 前面可带次数 (2week); none 表示不重复。 */
export function parseEvery(v) {
  if (v === "none") return "";
  const m = /^(\d*)(day|week|month|year)$/.exec(v.trim());
  if (!m) throw new ApiError(0, "--every 写成 day / week / month / year, 可带次数如 2week, 或 none");
  return { unit: m[2], n: m[1] ? Number(m[1]) : 1, tz: TZ_MIN };
}

// pdata 行 -> 待办 (去掉 id 的群前缀)
function rowTodo(item) {
  const b = item?.body ?? {};
  const prefix = `${b.channel}:`;
  return { ...b, id: item.id.startsWith(prefix) ? item.id.slice(prefix.length) : item.id, ver: item.ver };
}

const itemPath = (channel, id) => `${PATH_TODO_ITEMS}/${enc(todoRowId(channel, id))}`;

/** 命令行参数 -> 要改的字段; 空串表示清掉这个字段。 */
function fieldsOf(v) {
  const out = {};
  for (const k of TEXT_FIELDS) if (v[k] !== undefined) out[k] = v[k];
  for (const k of NUM_FIELDS) {
    if (v[k] === undefined) continue;
    const n = Number.parseInt(v[k], 10);
    if (v[k] !== "" && !Number.isInteger(n)) throw new ApiError(0, `--${k} 要是整数`);
    out[k] = v[k] === "" ? "" : n;
  }
  if (v.due !== undefined) out.due = v.due === "" ? "" : parseDue(v.due);
  if (v.every !== undefined) out.every = v.every === "" ? "" : parseEvery(v.every);
  for (const k of FLAG_FIELDS) if (v[k] !== undefined) out[k] = v[k] ? true : "";
  return out;
}

function merge(body, fields) {
  const b = { ...body };
  for (const [k, val] of Object.entries(fields)) {
    if (val === "") delete b[k];
    else b[k] = val;
  }
  return b;
}

async function put(cfg, channel, id, ver, body) {
  return (await call(cfg, "PUT", itemPath(channel, id), { ver, body })).item;
}

const conflictText = (e) => {
  const cur = e.data?.current;
  return cur && !cur.deleted ? `冲突, 当前是 (ver ${cur.ver}): ${todoLine(rowTodo(cur))}` : `冲突: ${e.message}`;
};

/** todo add <标题>: id 不给时用 t-<src> (占用了就加 -2 ...), 没有 src 用时间。 */
export async function todoAdd(cfg, channel, v, title, out) {
  if (!title?.trim()) throw new ApiError(0, "用法: hxaioa todo add <标题> [--prio n] [--area 生活] [--due \"11-30 18:00\"] [--remind 分钟] [--every month] [--star] [--alarm] [--repo r] [--issue n] [--parent id] [--note s] [--src seq] [--id id]");
  const fields = fieldsOf(v);
  delete fields.title;
  const body = merge({ channel, title: title.trim(), state: "open", prio: DEFAULT_PRIO, created: Date.now() }, fields);
  const base = v.id || (body.src ? `t-${body.src}` : `t-${Date.now().toString(36)}`);
  const auto = !v.id && !!body.src;
  for (let i = 1; ; i++) {
    const id = i === 1 ? base : `${base}-${i}`;
    try {
      const item = await put(cfg, channel, id, 0, body);
      out(`已建: ${todoLine(rowTodo(item))}`);
      return 0;
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 409) throw e;
      if (!auto || i >= MAX_SPLIT) {
        out(conflictText(e));
        return EXIT_CONFLICT;
      }
    }
  }
}

/** todo set <id> 改字段; todo done <id> 是 set --state done。基于刚读到的 ver 写, 冲突打印当前行。 */
export async function todoSet(cfg, channel, v, id, out, extra = {}) {
  if (!id) throw new ApiError(0, "用法: hxaioa todo set <id> [--title t] [--state s] [--prio n] [--area a] [--due d] [--remind m] [--every e] [--repo r] [--issue n] [--parent id] [--note s] [--src seq] (空串清掉)");
  const fields = { ...fieldsOf(v), ...extra };
  if (!Object.keys(fields).length) throw new ApiError(0, "没有要改的字段");
  let cur;
  try {
    cur = (await call(cfg, "GET", itemPath(channel, id))).item;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) throw new ApiError(404, `本群没有待办 ${id}`);
    throw e;
  }
  if (!cur || cur.deleted) throw new ApiError(404, `待办 ${id} 已删除`);
  try {
    const item = await put(cfg, channel, id, cur.ver, merge(cur.body, fields));
    out(`已更新: ${todoLine(rowTodo(item))}`);
    return 0;
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 409) throw e;
    out(conflictText(e));
    return EXIT_CONFLICT;
  }
}
