/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Set to '0' to build with no CAD support and therefore no LGPL artifacts. */
  readonly VITE_ENABLE_CAD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
