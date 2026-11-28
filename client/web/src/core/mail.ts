import {
  MAIL_PAGE_DEFAULT,
  PATH_MAIL,
  PATH_MAIL_BODY,
  PATH_MAIL_FACETS,
  PATH_MAIL_FORWARD,
  QUERY_BEFORE,
  QUERY_LIMIT,
  QUERY_MAIL_SEARCH,
  QUERY_VENDOR,
  type MailBody,
  type MailFacets,
  type MailList,
} from "@hx-aioa/protocol";
import { api, fill } from "./auth";

export type MailQuery = { vendor?: string; q?: string; before?: number };

// 邮件群 (对照安卓 MailApi.kt): 列表与筛选走服务端索引, 正文另取
export function mailList(p: MailQuery): Promise<MailList> {
  const qs = new URLSearchParams({ [QUERY_LIMIT]: String(MAIL_PAGE_DEFAULT) });
  if (p.vendor) qs.set(QUERY_VENDOR, p.vendor);
  if (p.q) qs.set(QUERY_MAIL_SEARCH, p.q);
  if (p.before) qs.set(QUERY_BEFORE, String(p.before));
  return api<MailList>(`${PATH_MAIL}?${qs}`);
}

export const mailFacets = (): Promise<MailFacets> => api<MailFacets>(PATH_MAIL_FACETS);

export async function mailBody(id: string): Promise<string> {
  return (await api<MailBody>(fill(PATH_MAIL_BODY, id))).html;
}

export async function mailForward(id: string, channel: string): Promise<void> {
  await api(fill(PATH_MAIL_FORWARD, id), { method: "POST", body: JSON.stringify({ channel }) });
}

