import {
  PATH_HXOA,
  PATH_HXOA_BROWSE,
  PATH_HXOA_ONE,
  PATH_HXOA_STATE,
  PATH_HXOA_TOKEN,
  PATH_HXOA_TOKEN_MERGE,
  PATH_HXOA_TOKEN_PROMPT,
  PATH_HXOA_WS,
  PATH_HXOA_WS_ONE,
  PATH_HXOA_WS_TOKENS,
  type HxoaBrowse,
  type HxoaConn,
  type HxoaConnInput,
  type HxoaNewToken,
  type HxoaState,
  type HxoaWsInput,
  type HxoaWsPatch,
} from "@hx-aioa/protocol";
import { api, fill } from "./auth";

// hxoa 远程管理 (插件 hengxin666.hxoa, 对照安卓 ui/hxoa): 管理令牌只在服务端, 这里只拿名字地址与状态
const json = (method: string, body?: unknown): RequestInit => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

export const hxoaConns = async (): Promise<HxoaConn[]> => (await api<{ conns: HxoaConn[] }>(PATH_HXOA)).conns ?? [];
export const hxoaAdd = (c: HxoaConnInput) => api<HxoaConn>(PATH_HXOA, json("POST", c));
export const hxoaRemove = (id: string) => api(fill(PATH_HXOA_ONE, id), json("DELETE"));
export const hxoaState = (id: string) => api<HxoaState>(fill(PATH_HXOA_STATE, id));
export const hxoaBrowse = (id: string, path: string) => api<HxoaBrowse>(`${fill(PATH_HXOA_BROWSE, id)}?path=${encodeURIComponent(path)}`);
export const hxoaAddWs = (id: string, w: HxoaWsInput) => api(fill(PATH_HXOA_WS, id), json("POST", w));
export const hxoaPatchWs = (id: string, ws: string, p: HxoaWsPatch) => api(fill(PATH_HXOA_WS_ONE, id, ws), json("PATCH", p));
export const hxoaDropWs = (id: string, ws: string) => api(fill(PATH_HXOA_WS_ONE, id, ws), json("DELETE"));
export const hxoaAddToken = (id: string, ws: string, label: string) => api<HxoaNewToken>(fill(PATH_HXOA_WS_TOKENS, id, ws), json("POST", { label }));
export const hxoaPrompt = async (id: string, tok: string) => (await api<{ prompt: string }>(fill(PATH_HXOA_TOKEN_PROMPT, id, tok))).prompt;
export const hxoaMerge = async (id: string, tok: string) => (await api<{ output: string }>(fill(PATH_HXOA_TOKEN_MERGE, id, tok), json("POST"))).output;
export const hxoaDropToken = (id: string, tok: string) => api(fill(PATH_HXOA_TOKEN, id, tok), json("DELETE"));
