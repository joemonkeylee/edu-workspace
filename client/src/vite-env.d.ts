/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_ENV?: 'DEV' | 'TEST' | 'PROD';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
