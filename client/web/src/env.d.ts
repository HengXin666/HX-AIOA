/// <reference types="vite/client" />

declare const __WEB_BUILD__: { web: number; sha: string };

interface ImportMetaEnv {
  readonly VITE_AIOA_DEV_SERVER?: string;
}
