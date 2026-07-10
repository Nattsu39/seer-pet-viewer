import { ref } from "vue";
import type { SwfClipData } from "@seer/swf-bundle";
import {
  parseBundleInWorker,
  loadSwfClipPackage,
  MaterialResolver,
  SHARED_SWF_MATERIAL_BUNDLE_NAME,
  type SwfClipJson,
} from "@seer/swf-bundle";
import type { SpineClipData } from "@seer/spine-bundle";
import {
  detectBundleKind,
  parseSpineBundleInWorker,
  loadSpineClipPackage,
  type SpineClipJson,
} from "@seer/spine-bundle";
import type {
  PetAnimIndexEntry,
  PetAnimSharedBundle,
} from "../lib/pet-anim-index";
import { fetchBundleFromIndex, isRemoteBundleAllowed, remoteBundleBlockedMessage, type DownloadProgress } from "../lib/remote-bundle";
import { withRuntimeAtlasTileWarning } from "../lib/swf-texture";

export interface RemoteLoadContext {
  entry: PetAnimIndexEntry;
  sharedBundles: PetAnimSharedBundle[];
}

function formatRemoteLoadError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function petLabel(entry: PetAnimIndexEntry): string {
  return `#${entry.id}（${entry.name}）`;
}

export type PetClip =
  | { type: "swf"; clip: SwfClipData }
  | { type: "spine"; clip: SpineClipData };

const SHARED_MATERIAL_BASE_NAME = SHARED_SWF_MATERIAL_BUNDLE_NAME.replace(
  /\.bundle$/,
  "",
);

export function usePetLoader() {
  const loading = ref(false);
  const error = ref<string | null>(null);
  const loadingMessage = ref<string | null>(null);
  const downloadProgress = ref<DownloadProgress | null>(null);
  const remoteLoadContext = ref<RemoteLoadContext | null>(null);
  const pet = ref<PetClip | null>(null);
  const parseMs = ref(0);
  const warnings = ref<string[]>([]);
  const materialCount = ref(0);
  const materialResolver = new MaterialResolver();

  let lastSwfBuffer: ArrayBuffer | null = null;
  let lastSwfFileName = "";
  let sharedMaterialRemoteLoaded = false;

  function reportDownloadProgress(progress: DownloadProgress) {
    downloadProgress.value = progress;
  }

  function clearDownloadProgress() {
    downloadProgress.value = null;
  }

  function materialSnapshot() {
    const snapshot = materialResolver.snapshot();
    return Object.keys(snapshot).length > 0 ? snapshot : undefined;
  }

  function buildSwfWarnings(parseWarnings: string[], clip: SwfClipData): string[] {
    const out = withRuntimeAtlasTileWarning(
      parseWarnings,
      clip.atlasWidth,
      clip.atlasHeight,
    );
    if (materialCount.value > 0) {
      out.unshift(`已加载 ${materialCount.value} 个 SWF 共享材质`);
    } else if (parseWarnings.some((w) => w.includes("外部文件"))) {
      out.unshift(
        `缺少 SWF 共享材质包，请导入 ${SHARED_SWF_MATERIAL_BUNDLE_NAME}`,
      );
    }
    return out;
  }

  async function parseBundleBuffer(buffer: ArrayBuffer, fileName: string) {
    const kind = await detectBundleKind(buffer);
    if (kind === "video") {
      throw new Error("不支持的视频 bundle（VideoClip）");
    }
    if (kind === "unknown") {
      throw new Error("无法识别的 bundle 格式");
    }

    if (kind === "spine") {
      lastSwfBuffer = null;
      lastSwfFileName = "";
      const clip = await parseSpineBundleInWorker(buffer.slice(0), fileName);
      pet.value = { type: "spine", clip };
    } else {
      lastSwfBuffer = buffer.slice(0);
      lastSwfFileName = fileName;
      const clip = await parseBundleInWorker(
        lastSwfBuffer,
        lastSwfFileName,
        materialSnapshot(),
      );
      pet.value = { type: "swf", clip };
      warnings.value = buildSwfWarnings(clip.materialWarnings, clip);
    }
  }

  async function loadBundleFile(file: File) {
    loading.value = true;
    error.value = null;
    remoteLoadContext.value = null;
    warnings.value = [];
    const t0 = performance.now();
    loadingMessage.value = `正在解析 ${file.name}…`;
    try {
      const buffer = await file.arrayBuffer();
      await parseBundleBuffer(buffer, file.name);
      parseMs.value = Math.round(performance.now() - t0);
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      pet.value = null;
    } finally {
      loading.value = false;
      loadingMessage.value = null;
      clearDownloadProgress();
    }
  }

  async function applyMaterialBundleBuffer(buffer: ArrayBuffer) {
    const { loadMaterialBundle, reparseSwfClip } = await import(
      "@seer/swf-bundle/parse"
    );
    const { count, warnings: w } = await loadMaterialBundle(
      buffer,
      materialResolver,
    );
    materialCount.value = materialResolver.size;

    if (pet.value?.type === "swf" && lastSwfBuffer) {
      const clip = await reparseSwfClip(
        lastSwfBuffer,
        lastSwfFileName,
        materialResolver,
        pet.value.clip.atlas,
      );
      pet.value = { type: "swf", clip };
      warnings.value = withRuntimeAtlasTileWarning(
        [
          `已导入 ${count} 个 SWF 共享材质，并已重新解析当前精灵`,
          ...w,
          ...clip.materialWarnings,
        ],
        clip.atlasWidth,
        clip.atlasHeight,
      );
    } else {
      warnings.value = [
        `已导入 ${count} 个 SWF 共享材质，导入 ppets_* bundle 后将自动应用`,
        ...w,
      ];
    }
    return count;
  }

  async function ensureSharedMaterialLoaded(
    sharedBundles: PetAnimSharedBundle[],
  ) {
    if (materialCount.value > 0 || sharedMaterialRemoteLoaded) {
      return;
    }

    const shared = sharedBundles.find((b) => b.name === SHARED_MATERIAL_BASE_NAME);
    if (!shared) {
      throw new Error(`索引中缺少共享材质包 ${SHARED_SWF_MATERIAL_BUNDLE_NAME}`);
    }

    const buffer = await fetchBundleFromIndex(shared, {
      onProgress: reportDownloadProgress,
    });
    await applyMaterialBundleBuffer(buffer);
    sharedMaterialRemoteLoaded = true;
  }

  async function loadBundleFromRemote(
    entry: PetAnimIndexEntry,
    sharedBundles: PetAnimSharedBundle[],
  ) {
    if (!isRemoteBundleAllowed(entry)) {
      error.value = remoteBundleBlockedMessage(entry.fileSize);
      remoteLoadContext.value = { entry, sharedBundles };
      return;
    }

    loading.value = true;
    error.value = null;
    warnings.value = [];
    remoteLoadContext.value = { entry, sharedBundles };
    clearDownloadProgress();
    const t0 = performance.now();
    try {
      if (entry.kind === "swf") {
        loadingMessage.value = `正在下载 SWF 共享材质…`;
        await ensureSharedMaterialLoaded(sharedBundles);
        clearDownloadProgress();
      }
      loadingMessage.value = `正在下载精灵 ${petLabel(entry)}…`;
      const buffer = await fetchBundleFromIndex(entry, {
        onProgress: reportDownloadProgress,
      });
      clearDownloadProgress();
      loadingMessage.value = `正在解析精灵 ${petLabel(entry)}…`;
      await parseBundleBuffer(buffer, `${entry.name}.bundle`);
      parseMs.value = Math.round(performance.now() - t0);
      remoteLoadContext.value = null;
    } catch (e) {
      error.value = formatRemoteLoadError(e);
      pet.value = null;
    } finally {
      loading.value = false;
      loadingMessage.value = null;
      clearDownloadProgress();
    }
  }

  async function retryRemoteLoad() {
    const ctx = remoteLoadContext.value;
    if (!ctx) return;
    await loadBundleFromRemote(ctx.entry, ctx.sharedBundles);
  }

  function dismissError() {
    error.value = null;
    remoteLoadContext.value = null;
  }

  async function loadSwfClipDir(files: FileList | File[]) {
    loading.value = true;
    error.value = null;
    lastSwfBuffer = null;
    lastSwfFileName = "";
    const t0 = performance.now();
    try {
      const list = Array.from(files);
      const metaFile = list.find((f) => f.name === "meta.json");
      const atlasFile = list.find((f) => f.name === "atlas.png");
      if (!metaFile || !atlasFile) {
        throw new Error("预转换包需包含 meta.json 与 atlas.png");
      }
      const meta = JSON.parse(await metaFile.text()) as SwfClipJson;
      const data = await loadSwfClipPackage(meta, atlasFile);
      pet.value = { type: "swf", clip: data };
      warnings.value = withRuntimeAtlasTileWarning(
        data.materialWarnings,
        data.atlasWidth,
        data.atlasHeight,
      );
      parseMs.value = Math.round(performance.now() - t0);
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      pet.value = null;
    } finally {
      loading.value = false;
    }
  }

  async function loadSpineClipDir(files: FileList | File[]) {
    loading.value = true;
    error.value = null;
    lastSwfBuffer = null;
    lastSwfFileName = "";
    const t0 = performance.now();
    try {
      const list = Array.from(files);
      const metaFile = list.find((f) => f.name === "meta.json");
      const skeletonFile = list.find(
        (f) => f.name === "skeleton.skel" || f.name.endsWith(".skel"),
      );
      const atlasFile = list.find(
        (f) => f.name === "atlas.atlas" || f.name.endsWith(".atlas"),
      );
      if (!metaFile || !skeletonFile || !atlasFile) {
        throw new Error(
          "Spine 预转换包需包含 meta.json、skeleton.skel 与 atlas.atlas",
        );
      }
      const meta = JSON.parse(await metaFile.text()) as SpineClipJson;
      const skeletonBytes = new Uint8Array(await skeletonFile.arrayBuffer());
      if (!meta.atlasText) {
        meta.atlasText = await atlasFile.text();
      }

      const textures = new Map<string, ImageBitmap>();
      for (const texMeta of meta.textures) {
        const file =
          list.find((f) => f.name === texMeta.name) ??
          list.find((f) => f.name.endsWith(`/${texMeta.name}`));
        if (!file) {
          throw new Error(`缺少纹理文件: ${texMeta.name}`);
        }
        textures.set(texMeta.name, await createImageBitmap(file));
      }

      const data = await loadSpineClipPackage(meta, skeletonBytes, textures);
      pet.value = { type: "spine", clip: data };
      parseMs.value = Math.round(performance.now() - t0);
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      pet.value = null;
    } finally {
      loading.value = false;
    }
  }

  async function loadMaterialBundleFile(file: File) {
    loading.value = true;
    error.value = null;
    const t0 = performance.now();
    try {
      const buffer = await file.arrayBuffer();
      await applyMaterialBundleBuffer(buffer);
      parseMs.value = Math.round(performance.now() - t0);
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  function reset() {
    pet.value = null;
    error.value = null;
    remoteLoadContext.value = null;
    loadingMessage.value = null;
    clearDownloadProgress();
    warnings.value = [];
    parseMs.value = 0;
    lastSwfBuffer = null;
    lastSwfFileName = "";
  }

  return {
    loading,
    error,
    loadingMessage,
    downloadProgress,
    remoteLoadContext,
    pet,
    parseMs,
    warnings,
    materialCount,
    sharedMaterialBundleName: SHARED_SWF_MATERIAL_BUNDLE_NAME,
    loadBundleFile,
    loadBundleFromRemote,
    retryRemoteLoad,
    dismissError,
    loadSwfClipDir,
    loadSpineClipDir,
    loadMaterialBundle: loadMaterialBundleFile,
    reset,
  };
}
