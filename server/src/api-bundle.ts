import { MAX_BUNDLE, PATH_EVENTS_BY_SEQS, QUERY_SEQS, parseSeqList, type EventsBySeqs } from "@hx-aioa/protocol";
import { canRead } from "./api-chats";
import { GET } from "./constants";
import { ROOM, type ReqCtx, type Route, route } from "./core";
import { fail, json } from "./http";
import { groupOf } from "./store";

/**
 * GET /events/seq?seqs=1,2,3 (#132): 合并转发详情一次取全, 最多 MAX_BUNDLE 条。
 * 主人都能取; 子号与 key 只给自己能读的群里的; 撤回 / 删除 / 不存在的不出现在结果里。
 */
function bySeqs(c: ReqCtx): Response {
  const seqs = parseSeqList(c.url.searchParams.get(QUERY_SEQS));
  if (!seqs) return fail(400, `seqs 需为逗号分隔的正整数, 最多 ${MAX_BUNDLE} 个`);
  const events = c.core.store.bySeqs(seqs).filter((ev) => {
    if (ev.deleted) return false;
    if (c.who.owner) return true;
    const grp = groupOf(ev);
    return !!grp && canRead(c.core, c.who, grp);
  });
  return json({ events } satisfies EventsBySeqs);
}

export const BUNDLE_ROUTES: Route[] = [route(GET, PATH_EVENTS_BY_SEQS, ROOM, bySeqs)];
