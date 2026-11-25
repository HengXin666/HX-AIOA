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
  // 可选, HX-CF-Drive: Service Binding, Drive 公网地址, Drive 后台建的受限令牌 (根目录 /aioa); 三项都配了才算接入
  DRIVE?: Fetcher;
  CFD_ORIGIN?: string;
  CFD_TOKEN?: string;
  // 可选, 插件市场根地址 (本地测试指向本机目录服务); 不配就用仓库 main 分支的 plugins/
  PLUGIN_MARKET?: string;
}
