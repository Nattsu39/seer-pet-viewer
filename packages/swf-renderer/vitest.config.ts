import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@seer/swf-bundle": resolve(__dirname, "../swf-bundle/src/index.ts"),
    },
  },
  test: {
    environment: "node",
  },
});
