import type { Hub } from "./hub";

export interface Env {
  HUB: DurableObjectNamespace<Hub>;
  AUTH_TOKEN: string;
  TOKEN_SECRET?: string;
  SETUP_CODE?: string;
  MIPUSH_APP_SECRET?: string;
  MIPUSH_PACKAGE?: string;
  WXPUSHER_APP_TOKEN?: string;
  WXPUSHER_UID?: string;
  GITHUB_TOKEN?: string;
  // CF 额度页: 只读 Account Analytics token 与账号 id
  CF_API_TOKEN?: string;
  CF_ACCOUNT_ID?: string;
  // 可选, 临时邮箱库, 每天清理超期邮件
  TEMP_MAIL_DB?: D1Database;
  // 可选, 文件桶 (R2), 没绑定时文件接口返回 503
  FILES?: R2Bucket;
}
