import { createApp, h, nextTick } from "vue";
import ExportModal from "../src/components/ExportModal.vue";
import { useAnimationExport } from "../src/composables/useAnimationExport";
import type { FrameCaptureSource } from "@seer-pet-anim/anim-export";

const source: FrameCaptureSource = {
  getSequenceFrameCount: () => 300,
  getExportFps: () => 30,
  async *captureFrames(options) {
    for (let index = 0; index < 300; index++) {
      if (options.signal?.aborted) throw options.signal.reason;
      yield {
        index,
        width: 32,
        height: 32,
        pixels: new Uint8Array(32 * 32 * 4),
      };
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  },
};

export async function mountExportUi() {
  const state = useAnimationExport();
  const host = document.createElement("div");
  document.body.append(host);
  const app = createApp({
    setup: () => () =>
      h(ExportModal, {
        open: true,
        exporting: state.exporting.value,
        exportError: state.exportError.value,
        exportNotice: state.exportNotice.value,
        exportMaxSide: state.exportMaxSide.value,
        exportProgressLabel: state.exportProgressLabel.value,
        exportFormat: state.exportFormat.value,
        exportScale: state.exportScale.value,
        exportBackground: state.exportBackground.value,
        mp4UnavailableReason: state.mp4UnavailableReason.value,
        canCancelExport: state.canCancelExport.value,
        exportBlocked: state.exportBlocked.value,
        "onUpdate:exportFormat": (value) => {
          state.exportFormat.value = value;
        },
        "onUpdate:exportBackground": (value) => {
          state.exportBackground.value = value;
        },
        onExport: () => state.runExport(source, 1, "standby", 0x123456),
        onCancelExport: state.cancelExport,
      }),
  });
  app.mount(host);
  await nextTick();
  return () => {
    state.cancelExport();
    app.unmount();
    host.remove();
  };
}
