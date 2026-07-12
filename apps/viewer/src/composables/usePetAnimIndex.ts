import { onMounted, shallowRef } from "vue";
import type { PetAnimIndex } from "../lib/pet-anim-index";
import { loadPetAnimIndex, resetPetAnimIndexCache } from "../lib/pet-anim-index";
import { isRemoteBundleEnabled } from "../lib/remote-bundle";

const index = shallowRef<PetAnimIndex | null>(null);
const indexError = shallowRef<string | null>(null);
const indexLoading = shallowRef(false);
let loadPromise: Promise<PetAnimIndex> | null = null;

async function ensureIndexLoaded(): Promise<PetAnimIndex | null> {
  if (!isRemoteBundleEnabled()) return null;
  if (index.value) return index.value;

  indexLoading.value = true;
  loadPromise ??= loadPetAnimIndex();
  try {
    const data = await loadPromise;
    index.value = data;
    indexError.value = null;
    return data;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    indexError.value = `资源索引加载失败：${message}`;
    loadPromise = null;
    return null;
  } finally {
    indexLoading.value = false;
  }
}

function startLoad(): void {
  if (index.value || indexLoading.value) return;
  void ensureIndexLoaded();
}

async function retryIndexLoad(): Promise<PetAnimIndex | null> {
  if (!isRemoteBundleEnabled()) return null;
  indexError.value = null;
  index.value = null;
  loadPromise = null;
  resetPetAnimIndexCache();
  return ensureIndexLoaded();
}

export function usePetAnimIndex() {
  onMounted(() => {
    startLoad();
  });

  return {
    index,
    indexError,
    indexLoading,
    ensureIndexLoaded,
    retryIndexLoad,
  };
}
