interface ImportMetaEnv {
  readonly VITE_AIOA_SERVER?: string;
  readonly VITE_AIOA_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
