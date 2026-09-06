/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_ENV?: 'DEV' | 'TEST' | 'PROD';
  readonly VITE_APP_COMMIT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
