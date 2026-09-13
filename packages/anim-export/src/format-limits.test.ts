import { afterEach, expect, it, vi } from "vitest";
import { exportAnimation } from "./export.js";
import { exportPngSequence } from "./png-sequence.js";
import { planReferenceExport } from "./export-dimensions.js";
import type { CaptureOptions, FrameCaptureSource } from "./types.js";

vi.mock("./export-worker-client.js", () => ({ createExportWorkerClient: () => null }));
vi.mock("./gif-encode.js", () => ({ encodeGifFrames: () => new Uint8Array([1]) }));
vi.mock("./webp-encode.js", () => ({ encodeAnimatedWebp: async () => new Uint8Array([1]) }));

afterEach(() => vi.unstubAllGlobals());

it.each(["gif", "webp", "png-sequence"] as const)("applies the %s limit before capture and accepts the resulting frame", async (format) => {
  const onViewportCrop = vi.fn();
  const captured: CaptureOptions[] = [];
  const source: FrameCaptureSource = {
    getSequenceFrameCount: () => 1,
    getExportFps: () => 24,
    async *captureFrames(options) {
      captured.push(options);
      // Thin frame exercises the real limit and pixel buffer path with little memory.
      const layout = planReferenceExport(
        { minX: 0, minY: 0, maxX: 20000, maxY: 1 }, 1, options.scale,
        options.maxSide, 0, options.viewport,
      );
      if (layout.crop) options.onViewportCrop?.(layout.crop);
      yield { index: 0, width: layout.width, height: layout.height, pixels: new Uint8Array(layout.width * layout.height * 4) };
    },
  };
  const encodePng = vi.fn(async () => new Blob([new Uint8Array([1])]));
  vi.stubGlobal("ImageData", class { constructor(..._args: unknown[]) {} });
  vi.stubGlobal("OffscreenCanvas", class {
    getContext() { return { putImageData: vi.fn() }; }
    convertToBlob = encodePng;
  });

  const options = { sequence: "attack", scale: 1, background: "transparent" as const, onViewportCrop, maxSide: 1 };
  const blob = format === "png-sequence"
    ? await exportPngSequence(source, { ...options, petId: 70 })
    : await exportAnimation(source, { ...options, format });
  const limit = format === "png-sequence" ? 16384 : 4096;
  expect(captured[0]?.maxSide).toBe(limit);
  expect(onViewportCrop).toHaveBeenCalledExactlyOnceWith({
    requested: { width: 20000, height: 1 }, output: { width: limit, height: 1 }, maxSide: limit,
  });
  expect(blob.size).toBeGreaterThan(0);
  if (format === "png-sequence") expect(encodePng).toHaveBeenCalledOnce();
});
