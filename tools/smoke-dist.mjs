// dist 产物冒烟检查:发布前验证"构建产物真实可用"。
//
// app 开发永远通过 Vite 别名消费 packages/*/src,dist 从不被执行;
// 本脚本补上这一环,防止盲发:
//   1. 包元数据完整(license/repository/files/engines/…,且无 private);
//   2. exports 映射的 types/import 文件真实存在;
//   3. 可在 Node 导入的入口动态 import 成功,且导出符号齐全;
//      /worker 入口是 worker 脚本(Node 下无 self/Worker),只验证文件存在;
//   4. 守卫:任何 dist JS 里不允许残留 new URL("…*.ts", import.meta.url)。
//
// 用法:node tools/smoke-dist.mjs

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGES = [
  "anim-export",
  "battle-layout",
  "spine-bundle",
  "spine-renderer",
  "swf-bundle",
  "swf-renderer",
];

// 各入口的期望导出符号(dist 冒烟只验证此处列出的公开 API 子集)
const EXPECTED_EXPORTS = {
  "battle-layout": {
    ".": [
      "BATTLE_DESIGN_WIDTH",
      "BATTLE_DESIGN_HEIGHT",
      "BATTLE_ANCHOR_UNITS",
      "BATTLE_PET_ANIM_SCALE",
      "battleSpaceVertexBounds",
      "computeBattlePetPlacement",
      "fitBattleCanvas",
      "projectBattlePlacement",
    ],
  },
  "spine-bundle": {
    ".": [
      "parseSpineBundleInWorker",
      "terminateSpineParserWorker",
      "detectBundleKind",
      "parseSpineBundle",
      "parseSpineBundleCore",
      "loadSpineClipPackage",
      "extractSpinePetId",
      "prepareSpineAtlasRgba",
    ],
    "./parse": ["parseSpineBundle", "parseSpineBundleCore"],
  },
  "spine-renderer": {
    ".": ["SpinePlayer"],
  },
  "swf-bundle": {
    ".": [
      "parseBundleInWorker",
      "parserWorkerAvailable",
      "terminateParserWorker",
      "loadSwfClipPackage",
      "swfClipDataToJson",
      "extractPetId",
      "SHARED_SWF_MATERIAL_BUNDLE_NAME",
      "getMaxTextureSize",
      "resetMaxTextureSizeCache",
    ],
    "./parse": [
      "parseBundleCore",
      "parseBundle",
      "extractAtlasBitmapFromBundle",
      "ensureSwfClipAtlas",
      "reparseSwfClip",
      "loadMaterialBundle",
    ],
  },
  "swf-renderer": {
    ".": ["SwfPlayer", "useHighPrecisionAtlasSampling"],
  },
  "anim-export": {
    ".": [
      "exportAnimation",
      "downloadBlob",
      "buildExportFilename",
      "exportPngSequence",
      "computeExportDimensions",
      "planReferenceExport",
      "planBattleViewportExport",
      "findAlphaBounds",
      "planTightExport",
    ],
    "./capture": [
      "findAlphaBounds",
      "planBattleViewportExport",
      "planTightExport",
      "REFERENCE_SEQUENCE",
    ],
    "./texture-alignment": ["detectTextureMisalignment"],
  },
};

// worker 入口在 Node 里不可执行(self/Worker 不存在),只做文件存在性检查
const WORKER_ENTRIES = new Set(["./worker"]);

const failures = [];
function check(ok, message) {
  if (!ok) failures.push(message);
}

function resolveExportsTarget(target) {
  if (typeof target === "string") return target;
  for (const key of ["types", "import", "default"]) {
    if (target[key]) return target[key];
  }
  return null;
}

// 运行时导入用:types 指向 .d.ts,不能作为执行入口
function resolveImportTarget(target) {
  if (typeof target === "string") return target;
  for (const key of ["import", "default"]) {
    if (target[key]) return target[key];
  }
  return null;
}

function collectExportsPaths(exportsMap) {
  const entries = [];
  for (const [key, value] of Object.entries(exportsMap)) {
    const path = key === "." ? "." : key.startsWith(".") ? key : `./${key}`;
    if (typeof value === "string" || ("types" in value || "import" in value || "default" in value)) {
      entries.push([path, value]);
    } else {
      entries.push(...collectExportsPaths(value));
    }
  }
  return entries;
}

// ---- 1. 元数据 ----
console.log("== 1/4 包元数据 ==");
for (const name of PACKAGES) {
  const pkgDir = join(repoRoot, "packages", name);
  const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
  const label = `packages/${name}`;
  check(!("private" in pkg), `${label}: 仍含 private 字段`);
  check(pkg.description && typeof pkg.description === "string", `${label}: description 缺失`);
  check(pkg.author === "Nattsu39", `${label}: author 不正确`);
  check(pkg.homepage?.includes(`packages/${name}`), `${label}: homepage 未指向包目录`);
  check(pkg.bugs?.includes("Nattsu39/seer-pet-viewer"), `${label}: bugs 不正确`);
  check(Array.isArray(pkg.keywords) && pkg.keywords.length > 0, `${label}: keywords 缺失`);
  check(pkg.license === "MIT", `${label}: license 缺失或非 MIT`);
  check(pkg.repository?.directory === `packages/${name}`, `${label}: repository.directory 不正确`);
  check(Array.isArray(pkg.files) && pkg.files.includes("dist"), `${label}: files 未包含 dist`);
  check(pkg.engines?.node === ">=20", `${label}: engines.node 缺失`);
  check(pkg.sideEffects === false, `${label}: sideEffects 未设为 false`);
  check(pkg.publishConfig?.access === "public", `${label}: publishConfig.access 缺失`);
  check(existsSync(join(pkgDir, "README.md")), `${label}: README.md 缺失`);
  check(existsSync(join(pkgDir, "LICENSE")), `${label}: LICENSE 缺失`);
}
console.log(failures.length === 0 ? "  通过" : `  失败 ${failures.length} 项`);

// ---- 2. exports 文件存在性 ----
console.log("== 2/4 exports 目标文件 ==");
for (const name of PACKAGES) {
  const pkgDir = join(repoRoot, "packages", name);
  const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
  const label = `packages/${name}`;
  for (const [entry, target] of collectExportsPaths(pkg.exports ?? {})) {
    const rel = resolveExportsTarget(target);
    if (!rel) {
      check(false, `${label}: exports["${entry}"] 无 types/import/default 目标`);
      continue;
    }
    check(existsSync(join(pkgDir, rel)), `${label}: exports["${entry}"] 指向不存在的 ${rel}`);
  }
}
console.log(failures.length === 0 ? "  通过" : `  失败 ${failures.length} 项`);

// ---- 3. 动态 import + 导出符号 ----
console.log("== 3/4 dist 入口导入与导出符号 ==");

// 文本扫描兜底:第三方依赖(@arkntools/unity-js、spine-core)的 dist 含无扩展名
// 相对导入,Node 严格 ESM 拒绝但打包器容忍(Q6 浏览器优先)。此时退化为在本包
// dist 源码里验证期望符号确实被导出,仍能覆盖"我们的 dist 缺符号"这类问题。
function packageDistExportsSymbol(pkgDir, symbol) {
  const named = new RegExp(`export\\s*\\{[^}]*\\b${symbol}\\b[^}]*\\}`);
  const decl = new RegExp(
    `export\\s+(?:declare\\s+)?(?:async\\s+)?(?:const|let|var|function\\*?|class)\\s+${symbol}\\b`,
  );
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (walk(full)) return true;
      } else if (entry.endsWith(".js")) {
        const code = readFileSync(full, "utf8");
        if (named.test(code) || decl.test(code)) return true;
      }
    }
    return false;
  };
  return walk(join(pkgDir, "dist"));
}

const isThirdPartyResolutionError = (error) =>
  error?.code === "ERR_MODULE_NOT_FOUND" &&
  /node_modules/.test(String(error.message));

for (const name of PACKAGES) {
  const pkgDir = join(repoRoot, "packages", name);
  const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
  const expected = EXPECTED_EXPORTS[name] ?? {};
  for (const [entry] of collectExportsPaths(pkg.exports ?? {})) {
    if (WORKER_ENTRIES.has(entry)) {
      console.log(`  ${name}${entry === "." ? "" : entry}: worker 入口,跳过执行导入`);
      continue;
    }
    const target = resolveImportTarget((pkg.exports ?? {})[entry]);
    if (!target) {
      check(false, `packages/${name}: exports["${entry}"] 无可执行入口`);
      continue;
    }
    const label = `packages/${name}${entry === "." ? "" : entry}`;
    const wanted = expected[entry] ?? [];
    try {
      const mod = await import(pathToFileURL(join(pkgDir, target)).href);
      const missing = wanted.filter((sym) => !(sym in mod));
      check(missing.length === 0, `${label}: dist 缺少导出符号 ${missing.join(", ")}`);
      console.log(
        `  ${label}: 导入成功,${Object.keys(mod).length} 个导出${wanted.length ? ",期望符号全部存在" : ""}`,
      );
    } catch (error) {
      if (isThirdPartyResolutionError(error)) {
        const missing = wanted.filter((sym) => !packageDistExportsSymbol(pkgDir, sym));
        check(missing.length === 0, `${label}: 文本扫描缺少导出符号 ${missing.join(", ")}`);
        console.log(
          `  ${label}: Node 无法执行导入(第三方依赖 ESM 兼容性),已用文本扫描验证 ${wanted.length} 个符号`,
        );
      } else {
        check(false, `${label}: dist 导入失败 — ${error.message}`);
      }
    }
  }
}

// ---- 4. .ts URL 残留守卫 ----
console.log("== 4/4 .ts URL 残留守卫 ==");
const RESIDUAL = /new URL\(\s*(['"])[^'"]*\.ts\1\s*,\s*import\.meta\.url\s*\)/;
let scanned = 0;
let residualCount = 0;
for (const name of PACKAGES) {
  const distDir = join(repoRoot, "packages", name, "dist");
  if (!existsSync(distDir)) {
    check(false, `packages/${name}: dist 不存在,请先构建`);
    continue;
  }
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".js")) {
        scanned += 1;
        if (RESIDUAL.test(readFileSync(full, "utf8"))) {
          residualCount += 1;
          check(false, `packages/${name}: ${relative(distDir, full)} 残留 .ts URL 引用`);
        }
      }
    }
  };
  walk(distDir);
}
console.log(
  `  扫描 ${scanned} 个 dist JS 文件,${residualCount === 0 ? "无残留" : `残留 ${residualCount} 处`}`,
);

console.log("");
if (failures.length > 0) {
  console.error(`冒烟检查失败,共 ${failures.length} 项:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("dist 冒烟检查全部通过");
