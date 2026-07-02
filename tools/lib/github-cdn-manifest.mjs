import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** GitHub 图床仓库中 PetAnimPackage 目录的前缀 */
export const GITHUB_CDN_REPO = "SeerAPI/seer-unity-assets-pet_anim_part";
export const GITHUB_CDN_BRANCH = "main";
export const GITHUB_CDN_PACKAGE_PATH = "newseer/assetbundles/PetAnimPackage";

/** jsDelivr 前缀（浏览器可直接跨域 fetch） */
export const DEFAULT_LARGE_BUNDLE_CDN_PREFIX = `https://cdn.jsdelivr.net/gh/${GITHUB_CDN_REPO}@${GITHUB_CDN_BRANCH}/${GITHUB_CDN_PACKAGE_PATH}`;

const TREE_API = `https://api.github.com/repos/${GITHUB_CDN_REPO}/git/trees/${GITHUB_CDN_BRANCH}?recursive=1`;
const JSDELIVR_FLAT_API = `https://data.jsdelivr.com/v1/package/gh/${GITHUB_CDN_REPO}@${GITHUB_CDN_BRANCH}/flat`;

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MANIFEST_PATH = resolve(
  __dirname,
  "../data/github-cdn-names.json",
);

/**
 * 将索引中的 bundle 名称映射为图床文件名。
 * 共享包在仓库中带 .bundle 后缀，精灵条目不带。
 * @param {string} bundleName
 */
export function githubCdnFileName(bundleName) {
  if (bundleName.startsWith("petanimpackage_share_")) {
    return `${bundleName}.bundle`;
  }
  return bundleName;
}

/**
 * @param {string} githubFileName 图床中的文件名（不含路径）
 * @returns {string} 索引中的 bundle 名称
 */
export function indexNameFromGithubFile(githubFileName) {
  if (githubFileName.endsWith(".bundle")) {
    return githubFileName.slice(0, -".bundle".length);
  }
  return githubFileName;
}

/**
 * @param {string} repoPath 仓库内完整路径
 * @returns {string | null}
 */
function nameFromRepoPath(repoPath) {
  const prefix = `${GITHUB_CDN_PACKAGE_PATH}/`;
  if (!repoPath.startsWith(prefix)) {
    return null;
  }
  const fileName = repoPath.slice(prefix.length);
  if (!fileName || fileName.includes("/")) {
    return null;
  }
  return indexNameFromGithubFile(fileName);
}

/**
 * @param {Array<{ path?: string; name?: string; type?: string }>} items
 */
function namesFromTreeItems(items) {
  const names = new Set();
  for (const item of items) {
    const repoPath = item.path ?? item.name;
    if (!repoPath) continue;
    const bundleName = nameFromRepoPath(repoPath);
    if (bundleName) {
      names.add(bundleName);
    }
  }
  return names;
}

async function fetchFromGithubApi() {
  const res = await fetch(TREE_API, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "seer-pet-viewer-build",
    },
  });

  if (!res.ok) {
    throw new Error(`GitHub API: HTTP ${res.status}`);
  }

  const data = await res.json();
  return namesFromTreeItems(data.tree ?? []);
}

async function fetchFromJsDelivrApi() {
  const res = await fetch(JSDELIVR_FLAT_API, {
    headers: { "User-Agent": "seer-pet-viewer-build" },
  });

  if (!res.ok) {
    throw new Error(`jsDelivr API: HTTP ${res.status}`);
  }

  const data = await res.json();
  const files = Array.isArray(data.files) ? data.files : [];
  return namesFromTreeItems(files);
}

/**
 * @param {string} [manifestPath]
 */
export function loadCommittedGithubCdnManifest(manifestPath = DEFAULT_MANIFEST_PATH) {
  if (!existsSync(manifestPath)) {
    return null;
  }

  const data = JSON.parse(readFileSync(manifestPath, "utf8"));
  const names = Array.isArray(data.names) ? data.names : [];
  return new Set(names.filter((name) => typeof name === "string" && name.length > 0));
}

/**
 * @param {Set<string>} names
 * @param {string} [rootDir] 仓库根目录，默认 tools/ 的上级
 */
export function writeGithubCdnManifest(names, rootDir = resolve(__dirname, "..")) {
  const manifestPath = resolve(rootDir, "tools/data/github-cdn-names.json");
  const payload = {
    repo: GITHUB_CDN_REPO,
    branch: GITHUB_CDN_BRANCH,
    packagePath: GITHUB_CDN_PACKAGE_PATH,
    updatedAt: new Date().toISOString(),
    names: [...names].sort(),
  };

  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  return manifestPath;
}

/**
 * 拉取图床已有文件列表。EO 等环境若无法访问 GitHub API，会回退到 jsDelivr 或仓库内清单。
 * @param {{ preferNetwork?: boolean; manifestPath?: string }} [options]
 * @returns {Promise<Set<string>>}
 */
export async function fetchGithubMirroredNames(options = {}) {
  const manifestPath = options.manifestPath ?? DEFAULT_MANIFEST_PATH;
  const errors = [];

  if (options.preferNetwork !== false) {
    try {
      const names = await fetchFromGithubApi();
      if (names.size > 0) {
        return names;
      }
      errors.push("GitHub API 返回空列表");
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }

    try {
      const names = await fetchFromJsDelivrApi();
      if (names.size > 0) {
        return names;
      }
      errors.push("jsDelivr API 返回空列表");
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  const committed = loadCommittedGithubCdnManifest(manifestPath);
  if (committed && committed.size > 0) {
    return committed;
  }

  throw new Error(
    `无法获取 GitHub 图床清单（${errors.join("；")}），且本地回退文件不存在或为空: ${manifestPath}`,
  );
}

/**
 * 构建索引时使用：网络优先，失败则静默回退到仓库内清单（适配 EO 构建环境）。
 * @param {{ manifestPath?: string }} [options]
 * @returns {Promise<{ names: Set<string>; source: string }>}
 */
export async function resolveMirroredNamesForBuild(options = {}) {
  const manifestPath = options.manifestPath ?? DEFAULT_MANIFEST_PATH;
  const errors = [];

  try {
    const names = await fetchFromGithubApi();
    if (names.size > 0) {
      return { names, source: "github-api" };
    }
    errors.push("GitHub API 返回空列表");
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  try {
    const names = await fetchFromJsDelivrApi();
    if (names.size > 0) {
      return { names, source: "jsdelivr-api" };
    }
    errors.push("jsDelivr API 返回空列表");
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  const committed = loadCommittedGithubCdnManifest(manifestPath);
  if (committed && committed.size > 0) {
    return { names: committed, source: "committed-manifest" };
  }

  console.warn(
    `警告: 无法拉取 GitHub 图床清单（${errors.join("；")}），且无本地回退文件；≥5 MB 条目不会写入 mirrored`,
  );
  return { names: new Set(), source: "none" };
}

// 兼容旧导入名
export { fetchGithubMirroredNames as loadMirroredNames };
