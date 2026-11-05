const PPETS_RE = /^ppets_(\d+)(_small)?$/;
const SPINE_RE = /^pskilltimeline_spines_(\d+)$/;
const SHARED_RE = /^petanimpackage_share_/;

/** @param {string} bundleName */
function classifyBundleName(bundleName) {
  const name = bundleName.replace(/\.bundle$/i, "");

  if (SHARED_RE.test(name)) {
    return { type: "shared", name };
  }

  const spineMatch = name.match(SPINE_RE);
  if (spineMatch) {
    return {
      type: "entry",
      kind: "spine",
      id: Number(spineMatch[1]),
      name,
    };
  }

  const ppetsMatch = name.match(PPETS_RE);
  if (ppetsMatch) {
    /** @type {{ type: string; kind: string; id: number; name: string; variant?: string }} */
    const entry = {
      type: "entry",
      kind: "swf",
      id: Number(ppetsMatch[1]),
      name,
    };
    if (ppetsMatch[2] === "_small") {
      entry.variant = "small";
    }
    return entry;
  }

  return { type: "skip", name };
}

const REMOTE_BUNDLE_MAX_BYTES = 5 * 1024 * 1024;

/**
 * @param {{ packageVersion: string; assets?: Array<{bundleId: number; dependIds: number[]}>; bundles: Array<{ bundleName: string; fileHash: string; fileSize: bigint }> }} manifest
 * @param {{ mirroredNames?: Set<string> }} [options]
 */
export function buildPetAnimIndex(manifest, options = {}) {
  const mirroredNames = options.mirroredNames ?? new Set();
  const swfAtlases = new Map();
  for (const asset of manifest.assets ?? []) {
    for (const id of asset.dependIds) {
      const name = manifest.bundles[id].bundleName.replace(/\.bundle$/i, "");
      if (/^petanimpackage_share_assets_swf_\d+$/.test(name)) {
        swfAtlases.set(asset.bundleId, name);
      }
    }
  }

  /** @type {Array<{ name: string; path: string; fileSize: number; mirrored?: boolean }>} */
  const sharedBundles = [];
  /** @type {Array<{ id: number; kind: string; variant?: string; sharedAtlas?: string; name: string; path: string; fileSize: number; mirrored?: boolean }>} */
  const entries = [];

  for (const [bundleId, bundle] of manifest.bundles.entries()) {
    const classified = classifyBundleName(bundle.bundleName);
    const path = bundle.fileHash;
    const fileSize = Number(bundle.fileSize);

    if (!/^[a-f0-9]{32}$/.test(path)) {
      throw new Error(`无效的 bundle hash: ${path} (${bundle.bundleName})`);
    }

    if (classified.type === "shared") {
      /** @type {{ name: string; path: string; fileSize: number; mirrored?: boolean }} */
      const shared = { name: classified.name, path, fileSize };
      if (fileSize >= REMOTE_BUNDLE_MAX_BYTES && mirroredNames.has(classified.name)) {
        shared.mirrored = true;
      }
      sharedBundles.push(shared);
      continue;
    }

    if (classified.type === "entry") {
      /** @type {{ id: number; kind: string; variant?: string; sharedAtlas?: string; name: string; path: string; fileSize: number; mirrored?: boolean }} */
      const entry = {
        id: classified.id,
        kind: classified.kind,
        name: classified.name,
        path,
        fileSize,
      };
      if (classified.variant) {
        entry.variant = classified.variant;
      }
      if (classified.kind === "swf" && swfAtlases.has(bundleId)) {
        entry.sharedAtlas = swfAtlases.get(bundleId);
      }
      if (fileSize >= REMOTE_BUNDLE_MAX_BYTES && mirroredNames.has(classified.name)) {
        entry.mirrored = true;
      }
      entries.push(entry);
    }
  }

  entries.sort((a, b) => {
    if (a.id !== b.id) return a.id - b.id;
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    if (a.variant === b.variant) return a.name.localeCompare(b.name);
    if (a.variant === "small") return 1;
    if (b.variant === "small") return -1;
    return a.name.localeCompare(b.name);
  });

  sharedBundles.sort((a, b) => a.name.localeCompare(b.name));

  return {
    version: manifest.packageVersion,
    updatedAt: new Date().toISOString(),
    sharedBundles,
    entries,
  };
}
