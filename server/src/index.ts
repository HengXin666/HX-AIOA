import { HEALTH_PATH, PROTOCOL_VERSION } from "@hx-aioa/protocol";
import { HEADER_INTERNAL_USER } from "./accounts/constants";
import { HUB_NAME } from "./constants";
import type { Env } from "./env";
import { json, preflight } from "./http";
import { fileData } from "./files/data";
import { cleanupTempMail, MAIL_CLEANUP_CRON } from "./mail-cleanup";
import { handleEmail } from "./mail/email";

export { Hub } from "./hub";

// Worker 只做 CORS 预检与健康检查, 鉴权与路由都在 Hub 内, 便于多账号时按用户分派
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS") return preflight();
    const url = new URL(req.url);
    if (url.pathname === HEALTH_PATH) return json({ ok: true, v: PROTOCOL_VERSION });
    const file = await fileData(req, env, url);
    if (file) return file;
    // 内部转发头只能由主 Hub 加, 外部传入的一律剥掉
    const headers = new Headers(req.headers);
    headers.delete(HEADER_INTERNAL_USER);
    return env.HUB.get(env.HUB.idFromName(HUB_NAME)).fetch(new Request(req, { headers }));
  },
  // CF 邮件路由投到本 Worker 的信: 解析后交给 Hub 进邮件群
  async email(msg: ForwardableEmailMessage, env: Env): Promise<void> {
    const hub = env.HUB.get(env.HUB.idFromName(HUB_NAME));
    await handleEmail(msg, async (input) => void (await hub.mailIn(input)));
  },
  async scheduled(ctrl: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (ctrl.cron === MAIL_CLEANUP_CRON) {
      ctx.waitUntil(cleanupTempMail(env).then((n) => console.log("临时邮箱清理:", n)).catch((e) => console.error("临时邮箱清理失败:", e)));
      ctx.waitUntil(env.HUB.get(env.HUB.idFromName(HUB_NAME)).mailPrune().then((n) => console.log("邮件索引清理:", n)));
      if (env.FILES) ctx.waitUntil(env.HUB.get(env.HUB.idFromName(HUB_NAME)).fileSweep().then((n) => console.log("文件清理:", n)));
      return;
    }
    const hub = env.HUB.get(env.HUB.idFromName(HUB_NAME));
    ctx.waitUntil(hub.todoIssueSync().catch((e) => console.error("待办 issue 同步失败:", e)));
    if (env.GITHUB_TOKEN) ctx.waitUntil(hub.githubSync().then((r) => console.log("GitHub 定时同步:", JSON.stringify(r))));
    if (env.CF_API_TOKEN && env.CF_ACCOUNT_ID) ctx.waitUntil(hub.cfCheck().catch((e) => console.error("CF 额度检查失败:", e)));
  },
} satisfies ExportedHandler<Env>;
