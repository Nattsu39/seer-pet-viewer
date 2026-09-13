// 发布构建收尾:把 dist 里指向 .ts 的 Worker URL 改写为 .js。
//
// 源码中 Worker 客户端写作 new Worker(new URL("./worker.ts", import.meta.url)),
// 这是 Vite 源码路径(app 以别名消费 src)所必需的;tsc 不会改写字符串字面量,
// 直接发布 dist 会让 Worker 加载指向不存在的 .ts 文件。
// tsc 产物中相对导入已被改写为 .js,只有这种字符串形式的引用需要本脚本处理。
//
// 用法:node tools/rewrite-worker-urls.mjs [packageDir ...]
// 无参数时扫描所有 packages/*/dist。发现无法改写的 .ts 引用或目标 .js 缺失时
// 以非零码退出,因此也可直接作为发布前的守卫运行。

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const WORKER_URL_PATTERN =
  /new URL\(\s*(['"])(\.\/[A-Za-z0-9_-]+)\.ts\1\s*,\s*import\.meta\.url\s*\)/g;

function listDistJsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listDistJsFiles(full));
    else if (entry.endsWith(".js")) out.push(full);
  }
  return out;
}

function collectPackageDirs(args) {
  if (args.length > 0) return args.map((arg) => resolve(arg));
  const packagesDir = join(repoRoot, "packages");
  return readdirSync(packagesDir)
    .map((name) => join(packagesDir, name))
    .filter((dir) => statSync(dir).isDirectory() && existsSync(join(dir, "dist")));
}

let rewrote = 0;
const errors = [];

for (const packageDir of collectPackageDirs(process.argv.slice(2))) {
  const distDir = join(packageDir, "dist");
  for (const file of listDistJsFiles(distDir)) {
    const code = readFileSync(file, "utf8");
    let fileRewrites = 0;

    const rewritten = code.replace(WORKER_URL_PATTERN, (match, quote, name) => {
      const target = join(dirname(file), `${name}.js`);
      if (!existsSync(target)) {
        errors.push(`${relative(repoRoot, file)}: 改写目标不存在 ${relative(repoRoot, target)}`);
        return match;
      }
      fileRewrites += 1;
      return `new URL(${quote}${name}.js${quote}, import.meta.url)`;
    });

    if (fileRewrites > 0) {
      writeFileSync(file, rewritten);
      console.log(
        `${relative(repoRoot, file)}: 改写 ${fileRewrites} 处 worker URL -> .js`,
      );
      rewrote += fileRewrites;
    }

    // 守卫:改写后不允许再有任何 new URL("...*.ts", import.meta.url) 形式的残留
    const RESIDUAL_PATTERN = /new URL\(\s*(['"])[^'"]*\.ts\1\s*,\s*import\.meta\.url\s*\)/;
    if (RESIDUAL_PATTERN.test(rewritten)) {
      errors.push(`${relative(repoRoot, file)}: 仍残留指向 .ts 的 new URL 引用`);
    }
  }
}

if (errors.length > 0) {
  console.error(`\nrewrite-worker-urls 失败:`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(`\nrewrite-worker-urls 完成:${rewrote} 处改写,无残留`);
