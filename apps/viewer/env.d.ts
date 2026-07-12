/// <reference types="vite/client" />
/// <reference path="../../packages/anim-export/src/shims.d.ts" />

interface ImportMetaEnv {
  readonly VITE_BUNDLE_PROXY_PREFIX?: string;
  /** 大文件 GitHub 图床前缀；留空禁用图床回退 */
  readonly VITE_LARGE_BUNDLE_CDN_PREFIX?: string;
}

declare const __APP_BUILD_ID__: string;

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<object, object, unknown>;
  export default component;
}
