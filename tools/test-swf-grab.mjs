import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "..");
const consumer = process.argv.includes("--consumer");
const production = process.argv.includes("--production");
const testRoot = resolve(
  root,
  consumer ? ".cache/swf-grab-consumer" : "packages/swf-renderer/browser-tests",
);
const require = createRequire(
  resolve(
    root,
    consumer
      ? ".cache/swf-grab-consumer/package.json"
      : "apps/viewer/package.json",
  ),
);
const { build, createServer, preview } = await import(
  pathToFileURL(require.resolve("vite")).href
);
const bundleRequire = createRequire(
  realpathSync(
    consumer
      ? resolve(testRoot, "node_modules/@seer-pet-anim/swf-bundle/package.json")
      : resolve(root, "packages/swf-bundle/package.json"),
  ),
);
const unityRoot = dirname(bundleRequire.resolve("@arkntools/unity-js"));
const real = process.argv.includes("--real");
const fixtureRoot = resolve(
  process.env.SWF_GRAB_FIXTURES || resolve(root, ".cache/swf-grab-fixtures"),
);
function fixtureMiddleware(vite) {
  vite.middlewares.use((request, response, next) => {
    if (request.url === "/favicon.ico") {
      response.writeHead(204).end();
      return;
    }
    const file = new Map([
      ["/fixtures/ppets_4911.bundle", "ppets_4911.bundle"],
      ["/fixtures/shared-materials.bundle", "shared-materials.bundle"],
    ]).get(request.url);
    if (!file) return next();
    const path = resolve(fixtureRoot, file);
    if (!existsSync(path)) {
      response.writeHead(404).end(`Missing fixture: ${file}`);
      return;
    }
    createReadStream(path).pipe(response);
  });
}
const config = {
  configFile: false,
  root: testRoot,
  resolve: {
    alias: {
      ...(!consumer
        ? {
            "@seer-pet-anim/swf-renderer": resolve(
              root,
              "packages/swf-renderer/src/index.ts",
            ),
            "@seer-pet-anim/swf-bundle/parse": resolve(
              root,
              "packages/swf-bundle/src/parse.ts",
            ),
            "@seer-pet-anim/swf-bundle": resolve(
              root,
              "packages/swf-bundle/src/index.ts",
            ),
          }
        : {}),
      [resolve(unityRoot, "utils/aes.js")]: resolve(
        unityRoot,
        "utils/aes.browser.js",
      ),
      [resolve(unityRoot, "lib/jimp/png.js")]: resolve(
        unityRoot,
        "lib/jimp/png.browser.js",
      ),
    },
  },
  define: { global: "globalThis" },
  plugins: [
    {
      name: "grab-fixtures",
      configureServer: fixtureMiddleware,
      configurePreviewServer: fixtureMiddleware,
    },
  ],
  server: { host: "127.0.0.1", port: 0, fs: { allow: [root] } },
  preview: { host: "127.0.0.1", port: 0 },
  build: { target: "esnext" },
  worker: { format: "es" },
};
if (production) await build(config);
const server = production ? await preview(config) : await createServer(config);
if (!production) await server.listen();
let browser;
try {
  browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "chrome",
    headless: true,
  });
  const page = await browser.newPage();
  const browserErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.goto(server.resolvedUrls.local[0] + (real ? "?real" : ""));
  await page.waitForFunction(() => "swfGrabTests" in window);
  const result = {
    browser: browser.version(),
    consumer,
    production,
    ...(await page.evaluate(() => window.swfGrabTests)),
  };
  if (browserErrors.length) {
    throw new Error(`Browser errors:\n${browserErrors.join("\n")}`);
  }
  const artifacts = resolve(root, ".cache/swf-grab-artifacts");
  mkdirSync(artifacts, { recursive: true });
  const report = `validation-${process.env.BROWSER_CHANNEL || "chrome"}-${real ? "real" : "synthetic"}-${consumer ? "packed" : "source"}-${production ? "production" : "dev"}.json`;
  writeFileSync(
    resolve(artifacts, report),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  if (production)
    await new Promise((resolve, reject) =>
      server.httpServer.close((error) => (error ? reject(error) : resolve())),
    );
  else await server.close();
}
