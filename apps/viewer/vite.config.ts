import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "node:path";

const unityJsRoot = resolve(
  __dirname,
  "../../node_modules/@arkntools/unity-js/dist",
);

export default defineConfig(({ command }) => ({
  plugins: [vue()],
  resolve: {
    alias: {
      "@seer/swf-bundle/parse": resolve(
        __dirname,
        "../../packages/swf-bundle/src/parse.ts",
      ),
      "@seer/swf-bundle": resolve(__dirname, "../../packages/swf-bundle/src"),
      "@seer/swf-renderer": resolve(__dirname, "../../packages/swf-renderer/src"),
      "@seer/spine-bundle": resolve(__dirname, "../../packages/spine-bundle/src"),
      "@seer/spine-renderer": resolve(
        __dirname,
        "../../packages/spine-renderer/src",
      ),
      buffer: "buffer/",
      [resolve(unityJsRoot, "utils/aes.js")]: resolve(
        unityJsRoot,
        "utils/aes.browser.js",
      ),
      [resolve(unityJsRoot, "lib/jimp/png.js")]: resolve(
        unityJsRoot,
        "lib/jimp/png.browser.js",
      ),
    },
  },
  define: {
    global: "globalThis",
  },
  optimizeDeps: {
    exclude: ["@jimp/wasm-png"],
    include: ["buffer", "@arkntools/unity-js"],
    esbuildOptions: {
      define: {
        global: "globalThis",
      },
    },
  },
  worker: {
    format: "es",
    plugins: () => [],
  },
  // dev/preview 用绝对路径；构建产物用相对路径，避免 file:// 或子路径部署时资源 404
  base: command === "build" ? "./" : "/",
  server: {
    proxy: {
      "/proxy": {
        target:
          "https://newseer.61.com/Assets/StandaloneWindows64/PetAnimPackage",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/proxy/, ""),
        headers: { referer: "https://newseer.61.com" },
      },
    },
  },
  build: {
    target: "esnext",
  },
}));
