import { computed, ref } from "vue";
import { getExportMaxSide } from "@seer/anim-export/capture";
import type {
  BattleCaptureOptions,
  ExportFormat,
  ExportProgress,
  ExportViewportCrop,
  FrameCaptureSource,
} from "@seer/anim-export";

export type ExportScale = 0.25 | 0.5 | 1 | 2 | 3;
export type ViewerExportFormat = ExportFormat | "png-sequence";

export function useAnimationExport() {
  const exporting = ref(false);
  const exportError = ref<string | null>(null);
  const exportNotice = ref<string | null>(null);
  const exportProgress = ref<ExportProgress | null>(null);
  const exportFormat = ref<ViewerExportFormat>("webp");
  const exportMaxSide = computed(() => getExportMaxSide(exportFormat.value));
  const exportScale = ref<ExportScale>(1);
  const exportBackground = ref(false);

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
    const onViewportCrop = ({ requested, output, maxSide }: ExportViewportCrop) => {
      const label = format === "png-sequence" ? "PNG 序列" : format === "gif" ? "GIF" : "WebP";
      exportNotice.value = `${label} 最长边上限为 ${maxSide}px，${requested.width}×${requested.height} 已裁剪为 ${output.width}×${output.height}；精灵倍率不变，超出部分不导出。`;
    };
    const background = exportBackground.value
      ? backgroundColor
      : "transparent";

    try {
      if (format === "png-sequence") {
        const { exportPngSequence, downloadBlob, buildPngSequenceFilename } =
          await import("@seer/anim-export");
        const blob = await exportPngSequence(
          source,
          {
            petId,
            sequence,
            scale: exportScale.value,
            background,
            battle,
            onViewportCrop,
          },
          (p: ExportProgress) => {
            exportProgress.value = p;
          },
        );
        downloadBlob(blob, buildPngSequenceFilename(petId, sequence));
      } else {
        const { exportAnimation, downloadBlob, buildExportFilename } =
          await import("@seer/anim-export");
        const blob = await exportAnimation(
          source,
          {
            sequence,
            scale: exportScale.value,
            background,
            format,
            battle,
            onViewportCrop,
          },
          (p: ExportProgress) => {
            exportProgress.value = p;
          },
        );
        downloadBlob(blob, buildExportFilename(petId, sequence, format));
      }
    } catch (err) {
      exportError.value =
        err instanceof Error ? err.message : "导出失败";
    } finally {
      exporting.value = false;
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
  };
}
