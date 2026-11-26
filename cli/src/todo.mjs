// 待办: 走插件数据接口 (pdata, hengxin666.todo/items), 行 id 为 <群>:<待办 id>, 写入带读到的 ver, 冲突时打印当前行
import { ApiError, call, enc } from "./http.mjs";
import { PATH_TODO_ITEMS, todoRowId } from "./proto.mjs";

export const EXIT_CONFLICT = 3;
const STATE_LABEL = { open: "待进行", hold: "挂起", doing: "进行中", done: "已完成", dropped: "已完成" };
const DEFAULT_PRIO = 2;
// 同一条消息拆多条时 id 加 -2, -3 ...
const MAX_SPLIT = 9;
const TEXT_FIELDS = ["title", "note", "repo", "parent", "state"];
const NUM_FIELDS = ["prio", "issue", "src"];
const NOTE_PREVIEW = 80;

/** 一行一条: [状态] P优先级 id 标题 (repo#issue) <- 父 | note */
export function todoLine(t) {
  const issue = t.repo && t.issue ? ` (${t.repo}#${t.issue})` : "";
  const parent = t.parent ? ` <- ${t.parent}` : "";
  const note = t.note ? ` | ${t.note.replace(/\s+/g, " ").slice(0, NOTE_PREVIEW)}` : "";
  return `[${STATE_LABEL[t.state] ?? t.state}] P${t.prio ?? DEFAULT_PRIO} ${t.id} ${t.title}${issue}${parent}${note}`;
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
  if (!title?.trim()) throw new ApiError(0, "用法: hxaioa todo add <标题> [--prio n] [--repo r] [--issue n] [--parent id] [--note s] [--src seq] [--id id]");
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
  if (!id) throw new ApiError(0, "用法: hxaioa todo set <id> [--title t] [--state s] [--prio n] [--repo r] [--issue n] [--parent id] [--note s] [--src seq]");
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
