import { APP_SCHEME, PATH_JOIN_PAGE, QUERY_CODE, QUERY_SERVER } from "@hx-aioa/protocol";
import { baseOf } from "./api-rooms";
import { GET } from "./constants";
import type { Core } from "./core";

const RELEASES = "https://github.com/HengXin666/HX-AIOA/releases/latest";
const PAGE_RE = new RegExp(`^${PATH_JOIN_PAGE.replace("{code}", "([^/]+)")}$`);
const HTML = "text/html; charset=utf-8";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// 邀请链接在浏览器里打开时的说明页: 有 App 直接拉起, 没有就下载后用邀请码注册或加入
export async function joinPage(core: Core, req: Request, url: URL): Promise<Response | null> {
  if (req.method !== GET) return null;
  const m = PAGE_RE.exec(url.pathname);
  if (!m) return null;
  const code = decodeURIComponent(m[1] ?? "");
  const r = await core.rooms.checkInvite(code);
  const base = baseOf(url);
  let body: string;
  if (typeof r === "string") {
    body = `<h1>邀请链接${r === "expired" ? "已过期或已用完" : "无效"}</h1><p>请让群主或管理员重新生成一个。</p>`;
  } else {
    const title = core.chats.chat(r.grp)?.title || r.grp;
    const app = `${APP_SCHEME}://join?${QUERY_SERVER}=${encodeURIComponent(base)}&${QUERY_CODE}=${encodeURIComponent(code)}`;
    body = [
      `<h1>邀请你加入群 "${esc(title)}"</h1>`,
      `<p><a class="btn" href="${esc(app)}">在 App 中打开</a></p>`,
      `<p>还没装 App: <a href="${RELEASES}">下载安卓版</a>, 登录页选 "邀请码注册", 填下面的服务地址和邀请码。</p>`,
      `<p>已经有账号: 在 App 的群聊列表点右上角 "加入群", 粘贴这个链接或邀请码。</p>`,
      `<dl><dt>服务地址</dt><dd><code>${esc(base)}</code></dd><dt>邀请码</dt><dd><code>${esc(code)}</code></dd></dl>`,
    ].join("");
  }
  const page = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>加入群</title><style>body{font:16px/1.6 system-ui,sans-serif;max-width:560px;margin:40px auto;padding:0 16px}code{word-break:break-all}.btn{display:inline-block;padding:10px 20px;border-radius:8px;background:#2563eb;color:#fff;text-decoration:none}@media (prefers-color-scheme:dark){body{background:#111;color:#ddd}a{color:#8ab4f8}}</style></head><body>${body}</body></html>`;
  return new Response(page, { headers: { "Content-Type": HTML, "Cache-Control": "no-store" } });
}
