import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@seer-pet-anim/swf-bundle": resolve(
        __dirname,
        "../swf-bundle/src/index.ts",
      ),
    },
  },
  test: {
    environment: "node",
  },
});
