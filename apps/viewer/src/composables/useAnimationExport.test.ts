import { beforeEach, expect, it, vi } from "vitest";
import { useAnimationExport } from "./useAnimationExport";

const mocks = vi.hoisted(() => ({ animation: vi.fn(), png: vi.fn(), download: vi.fn() }));
vi.mock("@seer-pet-anim/anim-export", async (importOriginal) => ({
  ...await importOriginal<typeof import("@seer-pet-anim/anim-export")>(),
  exportAnimation: mocks.animation,
  exportPngSequence: mocks.png,
  downloadBlob: mocks.download,
  buildExportFilename: () => "animation.webp",
  buildPngSequenceFilename: () => "frames.zip",
}));
const source = {
  async *captureFrames() {},
  getSequenceFrameCount: () => 1,
  getExportFps: () => 24,
};
beforeEach(() => vi.resetAllMocks());

it.each(["webp", "gif", "png-sequence"] as const)("exports %s at the selected scale without a fixed viewport", async (format) => {
  const state = useAnimationExport();
  state.exportFormat.value = format;
  state.exportScale.value = 0.25;
  await state.runExport(source, 70, "attack", 0);
  const encoder = format === "png-sequence" ? mocks.png : mocks.animation;
  expect(encoder).toHaveBeenCalledWith(source, expect.objectContaining({
    scale: 0.25,
  }), expect.any(Function));
  expect(encoder.mock.calls[0]?.[1]).not.toHaveProperty("viewport");
});

it("supports half-scale export without a fixed viewport", async () => {
  const state = useAnimationExport();
  state.exportScale.value = 0.5;
  await state.runExport(source, 70, "attack", 0);
  expect(mocks.animation.mock.calls[0]?.[1]).toMatchObject({ scale: 0.5 });
  expect(mocks.animation.mock.calls[0]?.[1]).not.toHaveProperty("viewport");
});

it("updates the displayed limit when switching formats", () => {
  const state = useAnimationExport();
  expect(state.exportMaxSide.value).toBe(4096);
  state.exportFormat.value = "png-sequence";
  expect(state.exportMaxSide.value).toBe(16384);
  state.exportFormat.value = "gif";
  expect(state.exportMaxSide.value).toBe(4096);
});

it.each(["webp", "gif", "png-sequence"] as const)("keeps the %s crop notice after export and resets it on the next export", async (format) => {
  const state = useAnimationExport();
  state.exportFormat.value = format;
  const maxSide = format === "png-sequence" ? 16384 : 4096;
  const encoder = format === "png-sequence" ? mocks.png : mocks.animation;
  encoder.mockImplementationOnce(async (_source, options) => {
    options.onViewportCrop({ requested: { width: 20000, height: 1080 }, output: { width: maxSide, height: 1080 }, maxSide });
    return new Blob();
  });
  await state.runExport(source, 70, "attack", 0);
  expect(state.exportError.value).toBeNull();
  expect(state.exportNotice.value).toContain(`20000×1080 已裁剪为 ${maxSide}×1080`);
  expect(mocks.download).toHaveBeenCalledOnce();
  await state.runExport(source, 70, "standby", 0);
  expect(state.exportNotice.value).toBeNull();
});
