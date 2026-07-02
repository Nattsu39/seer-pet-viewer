import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  fetchGithubMirroredNames,
  GITHUB_CDN_BRANCH,
  GITHUB_CDN_PACKAGE_PATH,
  GITHUB_CDN_REPO,
  writeGithubCdnManifest,
} from "./lib/github-cdn-manifest.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const names = await fetchGithubMirroredNames({ preferNetwork: true });
const outPath = writeGithubCdnManifest(names, ROOT);

console.log(`已写入 ${outPath}`);
console.log(`共 ${names.size} 个图床 bundle（${GITHUB_CDN_REPO}@${GITHUB_CDN_BRANCH}）`);
console.log(`路径前缀: ${GITHUB_CDN_PACKAGE_PATH}/`);
