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
  // 可选, GitHub 授权插件的设备码流程: OAuth App 或 GitHub App 的 client id; secret 只用于 GitHub App 令牌续期
  GH_CLIENT_ID?: string;
  GH_CLIENT_SECRET?: string;
  // CF 额度页: 只读 Account Analytics token 与账号 id
  CF_API_TOKEN?: string;
  CF_ACCOUNT_ID?: string;
  // 可选, 临时邮箱库, 每天清理超期邮件
  TEMP_MAIL_DB?: D1Database;
  // 可选, 文件桶 (R2), 没绑定时文件接口返回 503
  FILES?: R2Bucket;
  // 可选, 插件市场根地址 (本地测试指向本机目录服务); 不配就用仓库 main 分支的 plugins/
  PLUGIN_MARKET?: string;
  // 可选, 微软翻译 (F0 免费层): 密钥, 区域资源的区域 (全局资源不填), 每月自动停止线 (字符, 默认 180 万)
  AZURE_TRANSLATOR_KEY?: string;
  AZURE_TRANSLATOR_REGION?: string;
  TRANSLATE_MONTH_LIMIT?: string;
  // 可选, 强制翻译通道: azure | google; 不填时有微软密钥用微软, 否则用谷歌免费通道
  TRANSLATE_PROVIDER?: string;
}
