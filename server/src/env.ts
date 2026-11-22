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
}
