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

/**
 * @param {{ packageVersion: string; bundles: Array<{ bundleName: string; fileHash: string }> }} manifest
 */
export function buildPetAnimIndex(manifest) {
  /** @type {Array<{ name: string; path: string }>} */
  const sharedBundles = [];
  /** @type {Array<{ id: number; kind: string; variant?: string; name: string; path: string }>} */
  const entries = [];

  for (const bundle of manifest.bundles) {
    const classified = classifyBundleName(bundle.bundleName);
    const path = bundle.fileHash;

    if (!/^[a-f0-9]{32}$/.test(path)) {
      throw new Error(`无效的 bundle hash: ${path} (${bundle.bundleName})`);
    }

    if (classified.type === "shared") {
      sharedBundles.push({ name: classified.name, path });
      continue;
    }

    if (classified.type === "entry") {
      /** @type {{ id: number; kind: string; variant?: string; name: string; path: string }} */
      const entry = {
        id: classified.id,
        kind: classified.kind,
        name: classified.name,
        path,
      };
      if (classified.variant) {
        entry.variant = classified.variant;
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
