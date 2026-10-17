import { beforeEach, expect, it, vi } from "vitest";
import { useAnimationExport } from "./useAnimationExport";

const mocks = vi.hoisted(() => ({
  animation: vi.fn(),
  png: vi.fn(),
  download: vi.fn(),
  support: vi.fn(),
}));
vi.mock("@seer-pet-anim/anim-export", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@seer-pet-anim/anim-export")>()),
  exportAnimation: mocks.animation,
  exportPngSequence: mocks.png,
  downloadBlob: mocks.download,
  checkMp4Support: mocks.support,
  buildExportFilename: () => "animation.webp",
  buildPngSequenceFilename: () => "frames.zip",
}));
const source = {
  async *captureFrames() {},
  getSequenceFrameCount: () => 1,
  getExportFps: () => 24,
};

it.each(["webp", "gif", "png-sequence", "mp4"] as const)(
  "uses the supplied battle background for %s without changing the viewport",
  async (format) => {
    const state = useAnimationExport();
    state.exportFormat.value = format;
    const battle = {
      side: "left" as const,
      pxPerUnit: 100,
      containerWorldY: 0,
    };
    const encoder = format === "png-sequence" ? mocks.png : mocks.animation;

    state.exportBackground.value = true;
    await state.runExport(source, 70, "attack", 0x123456, battle);
    expect(encoder.mock.calls.at(-1)?.[1]).toMatchObject({
      background: 0x123456,
      battle,
    });

    state.exportBackground.value = false;
    await state.runExport(source, 70, "attack", 0x123456, battle);
    expect(encoder.mock.calls.at(-1)?.[1]).toMatchObject({
      background: format === "mp4" ? 0x123456 : "transparent",
      battle,
    });
  },
);
beforeEach(() => {
  vi.resetAllMocks();
  mocks.support.mockResolvedValue({ supported: true, reason: "" });
});

it.each(["webp", "gif", "png-sequence"] as const)(
  "exports %s at the selected scale without a fixed viewport",
  async (format) => {
    const state = useAnimationExport();
    state.exportFormat.value = format;
    state.exportScale.value = 0.25;
    await state.runExport(source, 70, "attack", 0);
    const encoder = format === "png-sequence" ? mocks.png : mocks.animation;
    expect(encoder).toHaveBeenCalledWith(
      source,
      expect.objectContaining({
        scale: 0.25,
      }),
      expect.any(Function),
    );
    expect(encoder.mock.calls[0]?.[1]).not.toHaveProperty("viewport");
  },
);

it("keeps MP4 unavailable until detection finishes and shows the detected reason", async () => {
  let finish!: (value: { supported: boolean; reason: string }) => void;
  mocks.support.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const state = useAnimationExport();
  expect(state.mp4UnavailableReason.value).toContain("检测");
  finish({ supported: false, reason: "缺少 VideoEncoder" });
  await Promise.resolve();
  expect(state.mp4UnavailableReason.value).toBe("缺少 VideoEncoder");
});

it("snapshots MP4 inputs, uses the current background, and prevents a late download after cancellation", async () => {
  let finish!: (blob: Blob) => void;
  mocks.animation.mockReturnValue(
    new Promise<Blob>((resolve) => {
      finish = resolve;
    }),
  );
  const state = useAnimationExport();
  state.exportFormat.value = "mp4";
  state.exportScale.value = 0.5;
  const pending = state.runExport(source, 70, "attack", 0x123456);
  state.exportScale.value = 3;
  await vi.waitFor(() => expect(mocks.animation).toHaveBeenCalledOnce());
  expect(mocks.animation.mock.calls[0][1]).toMatchObject({
    scale: 0.5,
    background: 0x123456,
  });
  state.cancelExport();
  expect(mocks.animation.mock.calls[0][1].signal.aborted).toBe(true);
  finish(new Blob());
  await pending;
  expect(mocks.download).not.toHaveBeenCalled();
  expect(state.exporting.value).toBe(false);
  expect(state.exportError.value).toBeNull();
  expect(state.exportBackground.value).toBe(false);
  await state.runExport(source, 70, "attack", 0x123456);
  expect(mocks.download).toHaveBeenCalledOnce();
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

it.each(["webp", "gif", "png-sequence"] as const)(
  "keeps the %s crop notice after export and resets it on the next export",
  async (format) => {
    const state = useAnimationExport();
    state.exportFormat.value = format;
    const maxSide = format === "png-sequence" ? 16384 : 4096;
    const encoder = format === "png-sequence" ? mocks.png : mocks.animation;
    encoder.mockImplementationOnce(async (_source, options) => {
      options.onViewportCrop({
        requested: { width: 20000, height: 1080 },
        output: { width: maxSide, height: 1080 },
        maxSide,
      });
      return new Blob();
    });
    await state.runExport(source, 70, "attack", 0);
    expect(state.exportError.value).toBeNull();
    expect(state.exportNotice.value).toContain(
      `20000×1080 已裁剪为 ${maxSide}×1080`,
    );
    expect(mocks.download).toHaveBeenCalledOnce();
    await state.runExport(source, 70, "standby", 0);
    expect(state.exportNotice.value).toBeNull();
  },
);
