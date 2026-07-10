import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { createReadStream, existsSync } from "node:fs";
import { resolve, join, normalize } from "node:path";

const unityJsRoot = resolve(
  __dirname,
  "../../node_modules/@arkntools/unity-js/dist",
);

export default defineConfig(({ command }) => ({
  plugins: [
    vue(),
    {
      name: "serve-repo-examples",
      configureServer(server) {
        const examplesRoot = resolve(__dirname, "../../examples");
        server.middlewares.use("/examples", (req, res, next) => {
          const urlPath = decodeURIComponent(req.url ?? "").replace(/^\//, "");
          const filePath = normalize(join(examplesRoot, urlPath));
          if (!filePath.startsWith(examplesRoot) || !existsSync(filePath)) {
            next();
            return;
          }
          if (filePath.endsWith(".png")) {
            res.setHeader("Content-Type", "image/png");
          } else if (filePath.endsWith(".json")) {
            res.setHeader("Content-Type", "application/json");
          }
          createReadStream(filePath).pipe(res);
        });
      },
    },
  ],
  resolve: {
    alias: [
      {
        find: "@seer/anim-export/texture-alignment",
        replacement: resolve(
          __dirname,
          "../../packages/anim-export/src/texture-alignment.ts",
        ),
      },
      {
        find: "@seer/anim-export/capture",
        replacement: resolve(
          __dirname,
          "../../packages/anim-export/src/capture.ts",
        ),
      },
      {
        find: "@seer/anim-export",
        replacement: resolve(
          __dirname,
          "../../packages/anim-export/src/index.ts",
        ),
      },
      {
        find: "@seer/swf-bundle/parse",
        replacement: resolve(
          __dirname,
          "../../packages/swf-bundle/src/parse.ts",
        ),
      },
      {
        find: "@seer/swf-bundle",
        replacement: resolve(__dirname, "../../packages/swf-bundle/src"),
      },
      {
        find: "@seer/swf-renderer",
        replacement: resolve(
          __dirname,
          "../../packages/swf-renderer/src/index.ts",
        ),
      },
      {
        find: "@seer/spine-bundle",
        replacement: resolve(
          __dirname,
          "../../packages/spine-bundle/src/index.ts",
        ),
      },
      {
        find: "@seer/spine-renderer",
        replacement: resolve(
          __dirname,
          "../../packages/spine-renderer/src/index.ts",
        ),
      },
      { find: "buffer", replacement: "buffer/" },
      {
        find: resolve(unityJsRoot, "utils/aes.js"),
        replacement: resolve(unityJsRoot, "utils/aes.browser.js"),
      },
      {
        find: resolve(unityJsRoot, "lib/jimp/png.js"),
        replacement: resolve(unityJsRoot, "lib/jimp/png.browser.js"),
      },
    ],
  },
  define: {
    global: "globalThis",
  },
  optimizeDeps: {
    exclude: ["@jimp/wasm-png", "wasm-webp"],
    include: ["buffer", "gifenc", "@arkntools/unity-js"],
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
    assetsInlineLimit: 0,
  },
}));
