/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** A jatekszerver WebSocket cime. Lasd .env / .env.local. */
  readonly VITE_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
