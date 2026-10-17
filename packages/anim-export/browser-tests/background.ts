import { exportAnimation } from "../src/export.js";
import type { FrameCaptureSource } from "../src/types.js";

export async function runBackgroundTests() {
  const results = [];
  for (const alpha of [255, 128, 0]) {
    const source: FrameCaptureSource = {
      getSequenceFrameCount: () => 2,
      getExportFps: () => 24,
      async *captureFrames() {
        for (let index = 0; index < 2; index++) {
          const pixels = new Uint8Array(32 * 32 * 4);
          for (let offset = 0; offset < pixels.length; offset += 4) {
            pixels.set([36, 104, 172, alpha], offset);
          }
          yield { index, width: 32, height: 32, pixels };
        }
      },
    };
    const blob = await exportAnimation(source, {
      sequence: "standby",
      scale: 1,
      format: "webp",
      background: alpha === 255 ? 0x2468ac : "transparent",
    });
    const bitmap = await createImageBitmap(blob);
    try {
      const canvas = new OffscreenCanvas(32, 32);
      const context = canvas.getContext("2d")!;
      context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(0, 0, 32, 32).data;
      const expected = alpha === 0 ? [0, 0, 0, 0] : [36, 104, 172, alpha];
      for (let offset = 0; offset < pixels.length; offset += 4) {
        const actual = pixels.subarray(offset, offset + 4);
        if (
          actual.some(
            (value, channel) => Math.abs(value - expected[channel]!) > 5,
          )
        ) {
          throw new Error(
            `WebP alpha ${alpha}, pixel ${offset / 4}: ${actual}; expected ${expected}`,
          );
        }
      }
      results.push({ alpha, pixel: [...pixels.subarray(0, 4)] });
    } finally {
      bitmap.close();
    }
  }
  return results;
}
