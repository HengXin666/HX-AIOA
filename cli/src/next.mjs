// next: 一轮的入口。打印简报 (变了才有全文), 记忆 (本轮第一次), 待处理消息; 没有就用长连等人发的消息
// 退出码: 0 有消息, 10 本次到点但窗口没满 (原样再跑), 2 idle 本轮结束, 11 idle 且今天要重算定时, 1 出错; 最后一行总是 "下一步: ..."
import { formatBrief, getNext } from "./brief.mjs";
import { loadConfig, loadState, saveRound } from "./config.mjs";
import { block } from "./format.mjs";
import { ApiError } from "./http.mjs";
import { settleWant } from "./skill.mjs";
import { watch } from "./watch.mjs";

export const EXIT_GOT = 0;
export const EXIT_AGAIN = 10;
export const EXIT_IDLE = 2;
export const EXIT_REPLAN = 11;
const REPLAN_STEP = "没有待处理的消息, 但今天要重算定时: 按 skill 的 references/schedule.md 做完就结束本轮";
const EXIT_ERROR = 1;
const DEFAULT_TIMEOUT_S = 100;
const SLACK_MS = 1000;
// 上一次调用之后这么久没再调, 当成上一轮半途断了, 这次重新开一轮
const ROUND_STALE_MS = 60 * 60 * 1000;
const EXPIRED = "skill_major_expired";

const num = (v) => (v === undefined ? undefined : Number.parseInt(v, 10));

function pendingText(list) {
  return [`== 待处理 ${list.length} 条`, ...list.map(block)];
}

function nextCmd(wait) {
  return `hxaioa next${wait > 0 ? ` --wait ${wait}` : ""}`;
}

/** 本轮状态: 没有或断了太久就开新的一轮 (first)。 */
function takeRound(now) {
  const r = loadState().round;
  const fresh = !r || now - (r.at ?? 0) > ROUND_STALE_MS;
  const round = fresh ? { started: now } : r;
  round.at = now;
  saveRound(round);
  return { round, first: fresh };
}

/** 等一段: 用 watch 的长连 (只认人发的消息, 不推进本地 head), 醒来返回 true。 */
async function waitHuman(cfg, me, channel, since, ms) {
  let got = false;
  const opts = { channels: [channel], peek: true, since, timeout: ms / 1000, deliver: () => (got = true) };
  await watch(cfg, me, opts);
  return got;
}

export async function next(cfg, v) {
  const wait = Math.max(0, num(v.wait) ?? 0);
  const cap = (num(v.timeout) ?? DEFAULT_TIMEOUT_S) * 1000;
  const out = [];
  const emit = async (code, step) => {
    out.push(...(await settleWant(loadConfig())), `下一步: ${step}`);
    process.stdout.write(`${out.join("\n")}\n`);
    return code;
  };
  const gotMsgs = (list) => {
    out.push(...pendingText(list));
    return emit(EXIT_GOT, `按 skill 逐条处理; 回复用 hxaioa send <文字> --reply <seq> --covers <这条回复一并处理掉的其它 seq>, 不用回复的用 hxaioa done <seq...>; 全部处理完再跑 ${nextCmd(wait)}`);
  };
  try {
    const now = Date.now();
    const { round, first } = takeRound(now);
    let r = await getNext(cfg, { start: first });
    const idle = (step) => {
      saveRound(null);
      out.push("idle: 本轮结束");
      return r.replan ? emit(EXIT_REPLAN, REPLAN_STEP) : emit(EXIT_IDLE, step);
    };
    if (r.brief) out.push(formatBrief(r.brief));
    if (first) out.push("== 长期记忆", r.memory?.trim() || "(还没有记忆)");
    if (r.pending.length) {
      saveRound({ ...round, until: 0 });
      return await gotMsgs(r.pending);
    }
    if (!wait) return await idle("没有待处理的消息, 结束本轮, 什么都不用发");
    // 窗口从本轮第一次空等开始算, 之后的调用接着等, 不重新计时
    const until = round.until || now + wait * 1000;
    saveRound({ ...round, until });
    const brief = r.current;
    const channel = brief?.channel || cfg.channel || cfg.me?.channel;
    const me = { ...(cfg.me ?? {}), channel };
    const stop = Math.min(now + cap, until);
    let since = r.head ?? 0;
    for (let left = stop - Date.now(); left > 0 && channel; left = stop - Date.now()) {
      if (!(await waitHuman(cfg, me, channel, since, left))) break;
      r = await getNext(cfg);
      if (r.brief) out.push(formatBrief(r.brief));
      if (r.pending.length) {
        saveRound({ ...round, until: 0, at: Date.now() });
        return await gotMsgs(r.pending);
      }
      since = Math.max(since, r.head ?? 0);
    }
    if (Date.now() < until - SLACK_MS) {
      out.push(`窗口没满 (还剩 ${Math.ceil((until - Date.now()) / 1000)} 秒)`);
      return await emit(EXIT_AGAIN, `原样再跑 ${nextCmd(wait)}`);
    }
    return await idle("窗口里没人说话, 结束本轮, 什么都不用发");
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    out.push(`出错: ${e.message}`);
    if (e.status === 409 && e.data?.code === EXPIRED) return emit(EXIT_ERROR, "旧版 skill 已过兼容期, 停下, 在群里告诉主人需要重新接入");
    return emit(EXIT_ERROR, `稍后原样再跑 ${nextCmd(wait)}; 一直出错就结束本轮`);
  }
}
