import { describe, expect, it } from "vitest";
import {
  detectTextureMisalignment,
  type RgbaImage,
} from "./texture-alignment.js";

function solidRgba(
  width: number,
  height: number,
  r: number,
  g: number,
  b: number,
  a: number,
): RgbaImage {
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    pixels[o] = r;
    pixels[o + 1] = g;
    pixels[o + 2] = b;
    pixels[o + 3] = a;
  }
  return { pixels, width, height };
}

function copyImage(source: RgbaImage): RgbaImage {
  return {
    pixels: new Uint8Array(source.pixels),
    width: source.width,
    height: source.height,
  };
}

function shiftImage(source: RgbaImage, dx: number, dy: number): RgbaImage {
  const out = solidRgba(source.width, source.height, 0, 0, 0, 0);
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      const tx = x + dx;
      const ty = y + dy;
      if (tx < 0 || ty < 0 || tx >= source.width || ty >= source.height) continue;
      const src = (y * source.width + x) * 4;
      const dst = (ty * source.width + tx) * 4;
      out.pixels[dst] = source.pixels[src]!;
      out.pixels[dst + 1] = source.pixels[src + 1]!;
      out.pixels[dst + 2] = source.pixels[src + 2]!;
      out.pixels[dst + 3] = source.pixels[src + 3]!;
    }
  }
  return out;
}

describe("detectTextureMisalignment", () => {
  it("reports ok for identical images", () => {
    const img = solidRgba(64, 64, 200, 80, 40, 255);
    const report = detectTextureMisalignment(img, copyImage(img));
    expect(report.verdict).toBe("ok");
    expect(report.misaligned).toBe(false);
    expect(report.mismatchRatio).toBe(0);
  });

  it("detects global shift misalignment", () => {
    const ref = solidRgba(80, 80, 0, 0, 0, 0);
    for (let y = 20; y < 60; y++) {
      for (let x = 20; x < 60; x++) {
        const i = (y * 80 + x) * 4;
        ref.pixels[i] = 220;
        ref.pixels[i + 1] = 120;
        ref.pixels[i + 2] = 60;
        ref.pixels[i + 3] = 255;
      }
    }
    const cur = shiftImage(ref, 4, 3);
    const report = detectTextureMisalignment(ref, cur, { maxShift: 8 });
    expect(report.verdict).toBe("shift_misalign");
    expect(report.misaligned).toBe(true);
    expect(report.bestShift).toEqual({ dx: 4, dy: 3 });
    expect(report.shiftGain).toBeGreaterThan(0.5);
  });

  it("detects texture content misalignment without fixable shift", () => {
    const ref = solidRgba(64, 64, 0, 0, 0, 0);
    const cur = solidRgba(64, 64, 0, 0, 0, 0);
    for (let y = 8; y < 56; y++) {
      for (let x = 8; x < 56; x++) {
        const i = (y * 64 + x) * 4;
        ref.pixels[i] = 40;
        ref.pixels[i + 1] = 180;
        ref.pixels[i + 2] = 220;
        ref.pixels[i + 3] = 255;
        cur.pixels[i] = 220;
        cur.pixels[i + 1] = 40;
        cur.pixels[i + 2] = 10;
        cur.pixels[i + 3] = 255;
      }
    }
    const report = detectTextureMisalignment(ref, cur);
    expect(report.verdict).toBe("texture_misalign");
    expect(report.misaligned).toBe(true);
    expect(report.mismatchRatio).toBeGreaterThan(0.2);
    expect(report.shiftGain).toBeLessThan(0.2);
  });

  it("compares overlapping region when sizes differ", () => {
    const ref = solidRgba(100, 80, 10, 20, 30, 255);
    const cur = solidRgba(100, 60, 10, 20, 30, 255);
    const report = detectTextureMisalignment(ref, cur);
    expect(report.sizeMismatch).toBe(true);
    expect(report.overlapSize).toEqual({ width: 100, height: 60 });
    expect(report.verdict).toBe("ok");
  });
});
