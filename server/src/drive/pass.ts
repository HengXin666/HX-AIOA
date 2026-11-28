import { DRIVE_PASS_PREFIX, DRIVE_PASS_TTL_MS, HEADER_DRIVE_PASS } from "@hx-aioa/protocol";
import { credentialOf, hmac, isOwnerToken, safeEqual } from "../auth";
import type { Env } from "../env";

// 通行证只认 Worker 与 Hub 都有的密钥, 与文件票据同一把
const secretOf = (env: Env) => env.TOKEN_SECRET || env.AUTH_TOKEN;
const text = (uid: string, exp: number) => `drive:${uid}:${exp}`;
const UID_RE = /^[\w-]{1,64}$/;

/** 签一张网盘通行证 (只给主人), 返回通行证与到期时间。 */
export async function signPass(env: Env, uid: string, now = Date.now()): Promise<{ pass: string; expires: number }> {
  const exp = now + DRIVE_PASS_TTL_MS;
  return { pass: `${DRIVE_PASS_PREFIX}${uid}.${exp}.${await hmac(secretOf(env), text(uid, exp))}`, expires: exp };
}

/** 校验通行证; 也接受 AUTH_TOKEN (脚本)。通过返回主人 id (AUTH_TOKEN 为 "owner"), 否则 null。 */
export async function checkPass(env: Env, req: Request, url: URL, now = Date.now()): Promise<string | null> {
  const raw = req.headers.get(HEADER_DRIVE_PASS) ?? "";
  if (raw.startsWith(DRIVE_PASS_PREFIX)) {
    const [uid, e, sig] = raw.slice(DRIVE_PASS_PREFIX.length).split(".");
    const exp = Number(e);
    if (!uid || !sig || !UID_RE.test(uid) || !Number.isFinite(exp) || exp < now) return null;
    return safeEqual(sig, await hmac(secretOf(env), text(uid, exp))) ? uid : null;
  }
  return isOwnerToken(credentialOf(req, url), env.AUTH_TOKEN) ? "owner" : null;
}
