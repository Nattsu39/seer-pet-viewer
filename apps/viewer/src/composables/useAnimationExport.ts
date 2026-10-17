import { computed, ref, shallowRef } from "vue";
import {
  type BattleCaptureOptions,
  type CaptureOptions,
  type ExportFormat,
  type ExportProgress,
  type FrameCaptureSource,
  type ExportViewportCrop,
  getExportMaxSide,
  checkMp4Support,
} from "@seer-pet-anim/anim-export";

export type ExportScale = 0.25 | 0.5 | 1 | 2 | 3;
export type ViewerExportFormat = ExportFormat | "png-sequence";

const FORMAT_LABEL: Record<ViewerExportFormat, string> = {
  gif: "GIF",
  webp: "WebP",
  mp4: "MP4",
  "png-sequence": "PNG 序列",
};

export function useAnimationExport() {
  const exporting = ref(false);
  const exportError = ref<string | null>(null);
  const exportNotice = ref<string | null>(null);
  const exportProgress = ref<ExportProgress | null>(null);
  const exportFormat = ref<ViewerExportFormat>("webp");
  const exportMaxSide = computed(() => getExportMaxSide(exportFormat.value));
  const exportScale = ref<ExportScale>(1);
  const exportBackground = ref(false);
  const mp4UnavailableReason = ref("正在检测 MP4 原生编码能力…");
  void checkMp4Support()
    .then((support) => {
      mp4UnavailableReason.value = support.supported ? "" : support.reason;
    })
    .catch((error: unknown) => {
      mp4UnavailableReason.value = `MP4 能力检测失败：${error instanceof Error ? error.message : error}`;
    });
  const exportController = shallowRef<AbortController>();
  const canCancelExport = computed(
    () => exporting.value && !!exportController.value,
  );
  const exportBlocked = computed(
    () => exportFormat.value === "mp4" && !!mp4UnavailableReason.value,
  );
  const exportProgressLabel = computed(() => {
    const progress = exportProgress.value;
    if (!progress) return "";
    const labels = {
      prepare: "准备画幅…",
      capture: "捕获",
      encode: "编码",
      mux: "封装 MP4…",
      complete: "完成",
    };
    return progress.total > 0
      ? `${labels[progress.phase]} ${progress.done}/${progress.total}`
      : labels[progress.phase];
  });

  function cancelExport(): void {
    exportController.value?.abort();
  }

  async function runExport(
    source: FrameCaptureSource,
    petId: number,
    sequence: string,
    backgroundColor: number,
    battle?: BattleCaptureOptions,
  ): Promise<void> {
    if (exporting.value) return;
    exporting.value = true;
    exportError.value = null;
    exportNotice.value = null;
    exportProgress.value = null;

    const format = exportFormat.value;
    const scale = exportScale.value;
    const battleSnapshot = battle ? { ...battle } : undefined;
    const controller = format === "mp4" ? new AbortController() : undefined;
    exportController.value = controller;
    const onViewportCrop = ({
      requested,
      output,
      maxSide,
    }: ExportViewportCrop) => {
      const label = FORMAT_LABEL[format];
      exportNotice.value = `${label} 导出画幅最长边上限为 ${maxSide}px，${requested.width}×${requested.height} 已裁剪为 ${output.width}×${output.height}；精灵倍率不变，超出部分不导出。`;
    };
    const background =
      format === "mp4" || exportBackground.value
        ? backgroundColor
        : "transparent";
    const captureOptions: CaptureOptions = {
      sequence,
      scale,
      background,
      battle: battleSnapshot,
      signal: controller?.signal,
      onViewportCrop,
    };
    const onProgress = (progress: ExportProgress) => {
      exportProgress.value = progress;
    };

    try {
      const {
        exportPngSequence,
        exportAnimation,
        downloadBlob,
        buildPngSequenceFilename,
        buildExportFilename,
      } = await import("@seer-pet-anim/anim-export");
      if (controller?.signal.aborted) return;
      let blob: Blob;
      let filename: string;
      if (format === "png-sequence") {
        blob = await exportPngSequence(
          source,
          { ...captureOptions, petId },
          onProgress,
        );
        filename = buildPngSequenceFilename(petId, sequence);
      } else {
        blob = await exportAnimation(
          source,
          { ...captureOptions, format },
          onProgress,
        );
        filename = buildExportFilename(petId, sequence, format);
      }
      if (!controller?.signal.aborted) downloadBlob(blob, filename);
    } catch (err) {
      if (!controller?.signal.aborted)
        exportError.value = err instanceof Error ? err.message : "导出失败";
    } finally {
      exporting.value = false;
      exportController.value = undefined;
      exportProgress.value = null;
    }
  }

  return {
    exporting,
    exportError,
    exportNotice,
    exportMaxSide,
    exportProgress,
    exportFormat,
    exportScale,
    exportBackground,
    runExport,
    mp4UnavailableReason,
    exportBlocked,
    exportProgressLabel,
    canCancelExport,
    cancelExport,
  };
}
