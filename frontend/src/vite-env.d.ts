/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEMO_PASSWORD?: string;
  readonly VITE_DEMO_ADMIN_PASSWORD?: string;
  readonly VITE_DEMO_ORG_PASSWORD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
