import { describe, expect, it } from "vitest";
import { MAX_FRAME_SIDE, cropCanvasSize, getExportMaxSide, validateCanvasSize } from "./canvas-size.js";
import { planReferenceExport } from "./export-dimensions.js";
import { copyRgbaPixels } from "./pixels.js";

describe("fixed-scale export limits", () => {
  it("accepts and copies frames beyond the previous 1920px cap", () => {
    expect(() => validateCanvasSize(2420, 997)).not.toThrow();
    const pixels = new Uint8Array(2420 * 4).fill(127);
    expect(copyRgbaPixels(pixels, 2420, 1)).toEqual(pixels);
    expect(() => validateCanvasSize(MAX_FRAME_SIDE, 1)).not.toThrow();
  });

  it.each(["gif", "webp", "png-sequence"] as const)("crops oversized %s layouts without scaling", (format) => {
    const limit = getExportMaxSide(format);
    expect(limit).toBe(format === "png-sequence" ? 16384 : 4096);
    const layout = planReferenceExport(
      { minX: 0, minY: 0, maxX: 20000, maxY: 1000 }, 1, 1, limit,
    );
    expect(layout.width).toBe(limit);
    expect(layout.height).toBe(1032);
    expect(layout.scale).toBe(1);
    expect(layout.crop).toEqual({ requested: { width: 20032, height: 1032 }, output: { width: limit, height: 1032 }, maxSide: limit });
    expect(() => validateCanvasSize(MAX_FRAME_SIDE + 1, 1)).toThrow("上限");
  });

  it.each([4096, 16384])("only crops axes exceeding the %spx boundary", (limit) => {
    expect(cropCanvasSize({ width: limit, height: 100 }, limit).crop).toBeUndefined();
    expect(cropCanvasSize({ width: 100, height: limit + 1 }, limit)).toMatchObject({ width: 100, height: limit });
    expect(cropCanvasSize({ width: limit + 1, height: limit + 1 }, limit)).toMatchObject({ width: limit, height: limit });
  });

  it("allows PNG pixel buffers above 4096px", () => {
    const pixels = new Uint8Array(16384 * 4).fill(127);
    expect(copyRgbaPixels(pixels, 16384, 1)).toEqual(pixels);
  });

  it.each([0, -1, NaN, Infinity])("rejects invalid user scale %s", (scale) => {
    expect(() => planReferenceExport(
      { minX: 0, minY: 0, maxX: 100, maxY: 200 }, 1, scale,
    )).toThrow("导出倍率");
  });
});
