/**
 * 验证 SWF 图集内存优化（P1）在真实浏览器里不破坏渲染。
 *
 * 覆盖：
 *   - Worker 内位图化 + transfer ImageBitmap 的解析链路
 *   - 就地 Y 翻转 / 就地边缘扩散的像素结果
 *   - GPU 上传后释放 CPU 图集位图（releaseAtlasAfterUpload）
 *   - 连续两次导入同一 bundle（destroy + 重新解析，图集已释放的分支）
 *   - 非分块与分块两条图集路径
 *
 * 用法:
 *   node tools/verify-swf-atlas-memory.mjs --serve
 *   node tools/verify-swf-atlas-memory.mjs --serve --bundle tools/.tmp-306/ppets_306.bundle
 *   node tools/verify-swf-atlas-memory.mjs --url http://localhost:5173/ --tile-size 1024
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import {
  DEFAULT_DEV_URL,
  DEFAULT_VIEWPORT,
  loadBundleIntoViewer,
  waitForBaselineHarness,
  waitForHttp,
  waitForRenderableContent,
} from "./lib/swf-baseline-lib.mjs";

function parseArgs(argv) {
  const opts = {
    url: DEFAULT_DEV_URL,
    serve: false,
    headless: true,
    rootDir: process.cwd(),
    bundle: "tools/.tmp-306/ppets_306.bundle",
    tileSize: 1024,
    passes: 2,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--serve") opts.serve = true;
    else if (arg === "--headed") opts.headless = false;
    else if (arg === "--url") opts.url = argv[++i] ?? opts.url;
    else if (arg === "--bundle") opts.bundle = argv[++i] ?? opts.bundle;
    else if (arg === "--tile-size") opts.tileSize = Number(argv[++i] ?? "1024");
    else if (arg === "--passes") opts.passes = Number(argv[++i] ?? "2");
    else if (arg === "--root") opts.rootDir = resolve(argv[++i] ?? opts.rootDir);
  }
  return opts;
}

async function maybeStartDevServer(serve, rootDir) {
  if (!serve) return { child: null, url: null };
  const child = spawn("pnpm", ["--filter", "@seer/viewer", "dev"], {
    cwd: rootDir,
    stdio: "pipe",
    shell: true,
  });
  const url = await new Promise((resolveUrl, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("dev server 启动超时")),
      180_000,
    );
    const onData = (chunk) => {
      const text = String(chunk);
      process.stdout.write(`[dev] ${text}`);
      const match = text.match(/https?:\/\/localhost:(\d+)\//);
      if (match) {
        clearTimeout(timeout);
        resolveUrl(`http://localhost:${match[1]}/`);
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`dev server 退出，code=${code}`));
    });
  });
  return { child, url };
}

/** Windows 下 pnpm 会再起一层 vite 子进程，只 kill 父进程会留下占端口的孤儿 */
function killProcessTree(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    // 必须同步等待：脚本随后就 process.exit()，异步 taskkill 会来不及执行
    const result = spawnSync("taskkill", [
      "/PID",
      String(child.pid),
      "/T",
      "/F",
    ]);
    if (result.status === 0) return;
  }
  child.kill();
}

async function readJsHeapMiB(page) {
  return page.evaluate(() => {
    const memory = performance.memory;
    if (!memory) return null;
    return Math.round(memory.usedJSHeapSize / (1024 * 1024));
  });
}

async function firstFrameAlphaBySequence(page) {
  return page.evaluate(async () => {
    const harness = window.__SEER_SWF_BASELINE__;
    const env = harness.getEnvironment();
    const out = [];
    for (const sequence of env.sequenceNames) {
      const frames = await harness.captureExportSequence({
        sequence,
        scale: 1,
        background: "transparent",
        renderFxLayers: true,
      });
      out.push({
        sequence,
        frames: frames.length,
        firstFrameAlpha: frames[0]?.nonZeroAlphaPixels ?? 0,
        firstFrameHash: frames[0]?.sha256 ?? null,
      });
    }
    return out;
  });
}

/** 关闭当前精灵：pet 变 null → PetViewer 卸载 → reset() 释放图集与解析 Worker */
async function closeCurrentPet(page) {
  const close = page.locator('button:has-text("关闭")').first();
  if ((await close.count()) === 0) return;
  await close.click();
  await page.waitForFunction(
    () => window.__SEER_SWF_BASELINE__?.ready !== true,
    { timeout: 60_000 },
  );
}

async function runMode(
  browser,
  { url, bundlePath, rootDir, label, tileSize, passes },
) {
  const page = await browser.newPage({ viewport: DEFAULT_VIEWPORT });
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  const target = tileSize ? `${url}?swfMaxTextureSize=${tileSize}` : url;
  await page.goto(target, { waitUntil: "domcontentloaded" });
  const blankHeapMiB = await readJsHeapMiB(page);

  const loads = [];
  for (let pass = 1; pass <= passes; pass++) {
    try {
      // 第二次起先关闭上一只精灵，否则等待条件会被上一只已渲染的精灵直接满足
      if (pass > 1) await closeCurrentPet(page);
      await loadBundleIntoViewer(page, { bundlePath, rootDir });
      await waitForBaselineHarness(page);
      await waitForRenderableContent(page);
      const environment = await page.evaluate(() =>
        window.__SEER_SWF_BASELINE__.getEnvironment(),
      );
      const sequences = await firstFrameAlphaBySequence(page);
      loads.push({
        pass,
        heapMiB: await readJsHeapMiB(page),
        atlasLogical: environment.atlasLogical,
        atlasBitmap: environment.atlasBitmap,
        atlasBitmapReleased: environment.atlasBitmapReleased,
        maxTextureSize: environment.maxTextureSize,
        tiled: Boolean(
          await page.evaluate(() =>
            window.__SEER_SWF_BASELINE__.getAtlasTileDebugInfo(),
          ),
        ),
        sequences,
      });
    } catch (error) {
      const detail = errors.length > 0 ? `\n  页面错误: ${errors.slice(0, 5).join("\n  ")}` : "";
      throw new Error(
        `[${label}] pass${pass} 失败: ${error instanceof Error ? error.message : String(error)}${detail}`,
      );
    }
  }

  await page.close();
  return { label, blankHeapMiB, loads, errors };
}

function checkMode(report) {
  const problems = [];
  if (report.errors.length > 0) {
    problems.push(`${report.label}: 控制台错误 ${report.errors[0]}`);
  }
  for (const load of report.loads) {
    if (!load.atlasBitmapReleased) {
      problems.push(
        `${report.label} pass${load.pass}: CPU 图集位图未释放（releaseAtlasAfterUpload 未生效）`,
      );
    }
    for (const seq of load.sequences) {
      if (seq.firstFrameAlpha <= 0) {
        problems.push(
          `${report.label} pass${load.pass}: 序列 ${seq.sequence} 首帧无可见像素`,
        );
      }
    }
  }
  const [first, second] = report.loads;
  if (first && second) {
    for (const seq of first.sequences) {
      const other = second.sequences.find((s) => s.sequence === seq.sequence);
      if (other && other.firstFrameHash !== seq.firstFrameHash) {
        problems.push(
          `${report.label}: 第二次导入的 ${seq.sequence} 首帧像素与第一次不一致`,
        );
      }
    }
  }
  return problems;
}

const opts = parseArgs(process.argv.slice(2));
const bundlePath = resolve(opts.rootDir, opts.bundle);
if (!existsSync(bundlePath)) {
  console.error(`找不到 bundle: ${bundlePath}`);
  process.exit(2);
}

const server = await maybeStartDevServer(opts.serve, opts.rootDir);
const url = server.url ?? opts.url;
let browser;
let failed = false;
try {
  await waitForHttp(url);
  browser = await chromium.launch({
    headless: opts.headless,
    args: ["--enable-precise-memory-info"],
  });

  const reports = [];
  reports.push(
    await runMode(browser, {
      url,
      bundlePath,
      rootDir: opts.rootDir,
      label: "device-max-texture-size",
      tileSize: null,
      passes: opts.passes,
    }),
  );
  reports.push(
    await runMode(browser, {
      url,
      bundlePath,
      rootDir: opts.rootDir,
      label: `tiled@${opts.tileSize}`,
      tileSize: opts.tileSize,
      passes: opts.passes,
    }),
  );

  const problems = reports.flatMap(checkMode);
  console.log("\n=== SWF 图集内存/渲染验证 ===");
  for (const report of reports) {
    console.log(`\n[${report.label}] 空页面 JS heap=${report.blankHeapMiB} MiB`);
    for (const load of report.loads) {
      console.log(
        `  pass${load.pass}: heap=${load.heapMiB} MiB  logical=${load.atlasLogical.width}×${load.atlasLogical.height}` +
          `  maxTextureSize=${load.maxTextureSize}  tiled=${load.tiled}  atlasBitmapReleased=${load.atlasBitmapReleased}`,
      );
      for (const seq of load.sequences) {
        console.log(
          `    ${seq.sequence}: frames=${seq.frames} firstFrameAlpha=${seq.firstFrameAlpha}`,
        );
      }
    }
    if (report.errors.length > 0) {
      console.log(`  控制台错误 ${report.errors.length} 条:`);
      for (const error of report.errors.slice(0, 5)) {
        console.log(`    ${error}`);
      }
    }
  }

  if (problems.length > 0) {
    failed = true;
    console.log("\n发现问题:");
    for (const problem of problems) console.log(`  - ${problem}`);
  } else {
    console.log("\n全部检查通过：两条图集路径均渲染正常且 CPU 图集已释放。");
  }
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  await browser?.close();
  if (server.child) {
    killProcessTree(server.child);
  }
}

process.exit(failed ? 1 : 0);
