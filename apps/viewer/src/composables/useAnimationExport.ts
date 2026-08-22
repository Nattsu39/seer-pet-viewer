import { ref } from "vue";
import type {
  ExportFormat,
  ExportProgress,
  FrameCaptureSource,
} from "@seer/anim-export";

export type ExportScale = 1 | 2 | 3;
export type ViewerExportFormat = ExportFormat | "png-sequence";

export function useAnimationExport() {
  const exporting = ref(false);
  const exportError = ref<string | null>(null);
  const exportProgress = ref<ExportProgress | null>(null);
  const exportFormat = ref<ViewerExportFormat>("webp");
  const exportScale = ref<ExportScale>(1);
  const exportBackground = ref(false);

  async function runExport(
    source: FrameCaptureSource,
    petId: number,
    sequence: string,
    backgroundColor: number,
  ): Promise<void> {
    if (exporting.value) return;
    exporting.value = true;
    exportError.value = null;
    exportProgress.value = null;

    const format = exportFormat.value;
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
    exportProgress,
    exportFormat,
    exportScale,
    exportBackground,
    runExport,
  };
}
