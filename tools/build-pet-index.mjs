/**
 * 从 newseer.61.com 远程拉取 PetAnimPackage 清单并生成 pet-anim-index.json
 *
 * 用法:
 *   node tools/build-pet-index.mjs
 *   node tools/build-pet-index.mjs --local path/to/PackageManifest_PetAnimPackage_*.bytes
 *   node tools/build-pet-index.mjs --local manifest.bytes --version 20260625181040
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchRemoteManifest } from "./lib/fetch-remote-manifest.mjs";
import { parseNewseerManifest } from "./lib/yoo-manifest-parser.mjs";
import { buildPetAnimIndex } from "./lib/pet-index-builder.mjs";
import { resolveMirroredNamesForBuild } from "./lib/github-cdn-manifest.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUTPUT = resolve(ROOT, "apps/viewer/public/pet-anim-index.json");

function parseArgs(argv) {
  /** @type {{ localPath?: string; version?: string; baseUrl?: string; skipGithubMirror?: boolean }} */
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--local" && argv[i + 1]) {
      options.localPath = argv[++i];
      continue;
    }
    if (arg === "--version" && argv[i + 1]) {
      options.version = argv[++i];
      continue;
    }
    if (arg === "--base-url" && argv[i + 1]) {
      options.baseUrl = argv[++i];
      continue;
    }
    if (arg === "--skip-github-mirror") {
      options.skipGithubMirror = true;
      continue;
    }
  }
  return options;
}

async function loadManifestBytes(options) {
  if (options.localPath) {
    const bytes = new Uint8Array(readFileSync(options.localPath));
    const version = options.version;
    if (!version) {
      throw new Error("使用 --local 时必须通过 --version 指定清单版本号");
    }
    console.log(`读取本地清单: ${options.localPath}`);
    return { version, bytes, manifestUrl: options.localPath };
  }

  const baseUrl =
    options.baseUrl ??
    process.env.PET_REMOTE_BASE ??
    "https://newseer.61.com/Assets/StandaloneWindows64/PetAnimPackage";

  console.log(`拉取远程清单: ${baseUrl}`);
  return fetchRemoteManifest(baseUrl);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { version, bytes, manifestUrl } = await loadManifestBytes(options);

  console.log(`清单版本: ${version}`);
  console.log(`清单来源: ${manifestUrl}`);
  console.log(`清单大小: ${bytes.byteLength} bytes`);

  const manifest = parseNewseerManifest(bytes);
  if (manifest.packageVersion !== version) {
    console.warn(
      `警告: 文件名版本 (${version}) 与清单内版本 (${manifest.packageVersion}) 不一致，使用清单内版本`,
    );
  }

  let mirroredNames = new Set();
  let mirrorSource = "skipped";
  if (!options.skipGithubMirror) {
    const resolved = await resolveMirroredNamesForBuild();
    mirroredNames = resolved.names;
    mirrorSource = resolved.source;
    if (mirroredNames.size > 0) {
      console.log(
        `GitHub 图床清单来源: ${mirrorSource}（${mirroredNames.size} 个 bundle）`,
      );
    }
  }

  const index = buildPetAnimIndex(manifest, { mirroredNames });
  const mirroredEntries = index.entries.filter((entry) => entry.mirrored).length;
  const mirroredShared = index.sharedBundles.filter((bundle) => bundle.mirrored)
    .length;

  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, JSON.stringify(index, null, 2) + "\n", "utf8");

  console.log(`已写入 ${OUTPUT}`);
  console.log(
    `共 ${manifest.bundles.length} 个 bundle，索引含 ${index.entries.length} 条精灵资源、${index.sharedBundles.length} 个共享包`,
  );
  if (mirroredNames.size > 0) {
    console.log(
      `其中 ≥5 MB 且已镜像到 GitHub 图床：精灵 ${mirroredEntries} 条、共享包 ${mirroredShared} 个`,
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
