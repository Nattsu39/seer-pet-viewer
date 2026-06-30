export interface PetAnimSharedBundle {
  name: string;
  path: string;
}

export interface PetAnimIndexEntry {
  id: number;
  kind: "swf" | "spine";
  variant?: "small";
  name: string;
  path: string;
}

export interface PetAnimIndex {
  version: string;
  updatedAt: string;
  sharedBundles: PetAnimSharedBundle[];
  entries: PetAnimIndexEntry[];
}

export async function loadPetAnimIndex(): Promise<PetAnimIndex> {
  const base = import.meta.env.BASE_URL;
  const url = `${base}pet-anim-index.json`.replace(/\/+/g, "/");
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`无法加载资源索引: ${res.status}`);
  }
  return res.json() as Promise<PetAnimIndex>;
}
