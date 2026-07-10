import { ref } from "vue";
import type { SwfClipData, SwfClipJson } from "@seer/swf-bundle";
import {
  parseBundleInWorker,
  loadSwfClipPackage,
  MaterialResolver,
} from "@seer/swf-bundle";
import { withRuntimeAtlasTileWarning } from "../lib/swf-texture";

export function useSwfLoader() {
  const loading = ref(false);
  const error = ref<string | null>(null);
  const clip = ref<SwfClipData | null>(null);
  const parseMs = ref(0);
  const warnings = ref<string[]>([]);
  const materialResolver = new MaterialResolver();

  async function loadBundleFile(file: File) {
    loading.value = true;
    error.value = null;
    warnings.value = [];
    const t0 = performance.now();
    try {
      const buffer = await file.arrayBuffer();
      const data = await parseBundleInWorker(buffer, file.name);
      clip.value = data;
      warnings.value = withRuntimeAtlasTileWarning(
        data.materialWarnings,
        data.atlasWidth,
        data.atlasHeight,
      );
      parseMs.value = Math.round(performance.now() - t0);
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      clip.value = null;
    } finally {
      loading.value = false;
    }
  }

  async function loadSwfClipDir(files: FileList | File[]) {
    loading.value = true;
    error.value = null;
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
      clip.value = data;
      warnings.value = withRuntimeAtlasTileWarning(
        data.materialWarnings,
        data.atlasWidth,
        data.atlasHeight,
      );
      parseMs.value = Math.round(performance.now() - t0);
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      clip.value = null;
    } finally {
      loading.value = false;
    }
  }

  async function loadMaterialBundleFile(file: File) {
    if (!clip.value) return;
    const buffer = await file.arrayBuffer();
    const { loadMaterialBundle } = await import("@seer/swf-bundle/parse");
    const { count, warnings: w } = await loadMaterialBundle(
      buffer,
      materialResolver,
    );
    warnings.value = [...warnings.value, `已导入 ${count} 个材质`, ...w];
  }

  function reset() {
    clip.value = null;
    error.value = null;
    warnings.value = [];
    parseMs.value = 0;
  }

  return {
    loading,
    error,
    clip,
    parseMs,
    warnings,
    loadBundleFile,
    loadSwfClipDir,
    loadMaterialBundle: loadMaterialBundleFile,
    reset,
  };
}
