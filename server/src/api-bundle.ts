import { BUNDLE_VIA_DEPTH, MAX_BUNDLE, PATH_EVENTS_BY_SEQS, QUERY_SEQS, QUERY_VIA, parseSeqList, type Envelope, type EventData, type EventsBySeqs } from "@hx-aioa/protocol";
import { canRead } from "./api-chats";
import { GET } from "./constants";
import { ROOM, type ReqCtx, type Route, route } from "./core";
import { fail, json } from "./http";
import { groupOf } from "./store";

const ERR_VIA = `via 需为逗号分隔的卡片 seq, 最多 ${BUNDLE_VIA_DEPTH} 个`;
const ERR_VIA_DENIED = "via 不是你能读到的合并转发卡片";

const refsOf = (ev: Envelope | undefined | null): number[] | null => {
  if (!ev || ev.deleted) return null;
  const refs = (ev.data as EventData | undefined)?.bundle?.refs;
  return Array.isArray(refs) ? refs : null;
};

const readable = (c: ReqCtx, ev: Envelope): boolean => {
  if (c.who.owner) return true;
  const grp = groupOf(ev);
  return !!grp && canRead(c.core, c.who, grp);
};

/** via 链: 第一张卡片要自己能读, 后面每张都在上一张的 refs 里; 返回最后一张的 refs, 不成立返回 null。 */
function viaRefs(c: ReqCtx, chain: number[]): Set<number> | null {
  let allowed: Set<number> | null = null;
  for (const seq of chain) {
    const ev = c.core.store.bySeq(seq);
    const refs = refsOf(ev);
    if (!ev || !refs) return null;
    if (allowed ? !allowed.has(seq) : !readable(c, ev)) return null;
    allowed = new Set(refs);
  }
  return allowed;
}

/**
 * GET /events/seq?seqs=1,2,3[&via=卡片] (#132): 合并转发详情一次取全, 最多 MAX_BUNDLE 条。
 * 主人都能取; 子号与 key 给自己能读的群里的, 以及能读到的 via 卡片 refs 里的; 撤回 / 删除 / 不存在的不出现在结果里。
 */
function bySeqs(c: ReqCtx): Response {
  const seqs = parseSeqList(c.url.searchParams.get(QUERY_SEQS));
  if (!seqs) return fail(400, `seqs 需为逗号分隔的正整数, 最多 ${MAX_BUNDLE} 个`);
  const rawVia = c.url.searchParams.get(QUERY_VIA);
  let via: Set<number> | null = null;
  if (rawVia !== null) {
    const chain = parseSeqList(rawVia);
    if (!chain || chain.length > BUNDLE_VIA_DEPTH) return fail(400, ERR_VIA);
    via = viaRefs(c, chain);
    if (!via) return fail(403, ERR_VIA_DENIED);
  }
  const events = c.core.store.bySeqs(seqs).filter((ev) => !ev.deleted && (via?.has(ev.seq) || readable(c, ev)));
  return json({ events } satisfies EventsBySeqs);
}

export const BUNDLE_ROUTES: Route[] = [route(GET, PATH_EVENTS_BY_SEQS, ROOM, bySeqs)];
