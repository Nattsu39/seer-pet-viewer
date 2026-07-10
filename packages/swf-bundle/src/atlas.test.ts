import { describe, expect, it, vi } from "vitest";
import {
  atlasPixelsToBitmap,
  bleedAtlasEdges,
  prepareAtlasRgba,
  zeroTransparentRgb,
} from "./atlas.js";
import {
  computeFitTextureSize,
  fitRgbaToMaxTextureSize,
} from "./max-texture-size.js";

describe("computeFitTextureSize", () => {
  it("downscales 8192 square atlas to 4096", () => {
    expect(computeFitTextureSize(8192, 8192, 4096)).toEqual({
      width: 4096,
      height: 4096,
      scale: 0.5,
    });
  });

  it("keeps textures within the device limit unchanged", () => {
    expect(computeFitTextureSize(2048, 1024, 4096)).toEqual({
      width: 2048,
      height: 1024,
      scale: 1,
    });
  });

  it("fits non-square oversized atlases proportionally", () => {
    expect(computeFitTextureSize(8192, 4096, 4096)).toEqual({
      width: 4096,
      height: 2048,
      scale: 0.5,
    });
  });
});

describe("fitRgbaToMaxTextureSize", () => {
  it("returns the same buffer when already within limits", async () => {
    const rgba = new Uint8ClampedArray(4);
    const result = await fitRgbaToMaxTextureSize(rgba, 1, 1, 4096);
    expect(result.scaled).toBe(false);
    expect(result.width).toBe(1);
    expect(result.height).toBe(1);
    expect(result.rgba).toBe(rgba);
  });

  it("downscales rgba to the requested max side", async () => {
    const width = 64;
    const height = 64;
    const rgba = new Uint8ClampedArray(width * height * 4);
    rgba.fill(255);
    for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;

    const result = await fitRgbaToMaxTextureSize(rgba, width, height, 32);
    expect(result.scaled).toBe(true);
    expect(result.width).toBe(32);
    expect(result.height).toBe(32);
    expect(result.rgba.length).toBe(32 * 32 * 4);
    expect(result.originalWidth).toBe(64);
    expect(result.originalHeight).toBe(64);
  });
});

describe("atlasPixelsToBitmap", () => {
  it("keeps full resolution without downscaling", async () => {
    const width = 64;
    const height = 32;
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < rgba.length; i += 4) {
      rgba[i] = 10;
      rgba[i + 1] = 20;
      rgba[i + 2] = 30;
      rgba[i + 3] = i % 8 === 0 ? 255 : 0;
    }

    const close = vi.fn();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width, height, close })),
    );
    if (typeof ImageData === "undefined") {
      vi.stubGlobal(
        "ImageData",
        class {
          data: Uint8ClampedArray;
          width: number;
          height: number;
          constructor(data: Uint8ClampedArray, w: number, h: number) {
            this.data = data;
            this.width = w;
            this.height = h;
          }
        },
      );
    }

    const prepared = await atlasPixelsToBitmap({ width, height, rgba });
    expect(prepared.scaled).toBe(false);
    expect(prepared.width).toBe(width);
    expect(prepared.height).toBe(height);
    expect(prepared.originalWidth).toBe(width);
    expect(prepared.originalHeight).toBe(height);
    prepared.bitmap.close();
    vi.unstubAllGlobals();
  });
});

describe("zeroTransparentRgb", () => {
  it("clears RGB on fully transparent pixels", () => {
    const rgba = new Uint8ClampedArray([200, 100, 50, 0, 10, 20, 30, 255]);
    zeroTransparentRgb(rgba);
    expect(Array.from(rgba.slice(0, 4))).toEqual([0, 0, 0, 0]);
    expect(Array.from(rgba.slice(4))).toEqual([10, 20, 30, 255]);
  });
});

describe("prepareAtlasRgba", () => {
  it("zeros then bleeds opaque edge into transparent padding", () => {
    const w = 5;
    const h = 3;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let x = 1; x <= 3; x++) {
      const i = (1 * w + x) * 4;
      rgba[i] = 200;
      rgba[i + 1] = 100;
      rgba[i + 2] = 50;
      rgba[i + 3] = 255;
    }
    const leftPad = (1 * w + 0) * 4;
    rgba[leftPad] = 99;
    rgba[leftPad + 1] = 88;
    rgba[leftPad + 2] = 77;
    rgba[leftPad + 3] = 0;

    prepareAtlasRgba(rgba, w, h);
    expect(rgba[leftPad + 3]).toBe(0);
    expect(rgba[leftPad]).toBe(200);
    expect(rgba[leftPad + 1]).toBe(100);
    expect(rgba[leftPad + 2]).toBe(50);
  });
});

describe("bleedAtlasEdges", () => {
  it("spreads opaque edge RGB into transparent padding", () => {
    const w = 5;
    const h = 3;
    const rgba = new Uint8ClampedArray(w * h * 4);
    // 中间 3x1 不透明条
    for (let x = 1; x <= 3; x++) {
      const i = (1 * w + x) * 4;
      rgba[i] = 200;
      rgba[i + 1] = 100;
      rgba[i + 2] = 50;
      rgba[i + 3] = 255;
    }

    bleedAtlasEdges(rgba, w, h, 1);

    const leftPad = (1 * w + 0) * 4;
    expect(rgba[leftPad + 3]).toBe(0);
    expect(rgba[leftPad]).toBe(200);
    expect(rgba[leftPad + 1]).toBe(100);
    expect(rgba[leftPad + 2]).toBe(50);
  });
});
