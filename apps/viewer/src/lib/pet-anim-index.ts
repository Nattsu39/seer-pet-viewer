export interface PetAnimSharedBundle {
  name: string;
  path: string;
  fileSize: number;
  /** ≥5 MB 且已上传至 GitHub 图床 */
  mirrored?: boolean;
}

export interface PetAnimIndexEntry {
  id: number;
  kind: "swf" | "spine";
  variant?: "small";
  name: string;
  path: string;
  fileSize: number;
  /** ≥5 MB 且已上传至 GitHub 图床 */
  mirrored?: boolean;
}

export interface PetAnimIndex {
  version: string;
  updatedAt: string;
  sharedBundles: PetAnimSharedBundle[];
  entries: PetAnimIndexEntry[];
}

let cachedIndex: Promise<PetAnimIndex> | null = null;

export function resetPetAnimIndexCache(): void {
  cachedIndex = null;
}

async function fetchPetAnimIndex(): Promise<PetAnimIndex> {
  const base = import.meta.env.BASE_URL;
  const url = `${base}pet-anim-index.json?v=${encodeURIComponent(__APP_BUILD_ID__)}`.replace(
    /\/+/g,
    "/",
  );
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`无法加载资源索引: ${res.status}`);
  }
  return res.json() as Promise<PetAnimIndex>;
}

export function loadPetAnimIndex(): Promise<PetAnimIndex> {
  cachedIndex ??= fetchPetAnimIndex();
  return cachedIndex;
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
