import { describe, expect, it } from "vitest";
import {
  EXPORT_BOUNDS_ALPHA_THRESHOLD,
  EXPORT_BOUNDS_MIN_EDGE_OPAQUE,
  findAlphaBounds,
  findSignificantAlphaBounds,
} from "./alpha-bounds.js";

function rgba(w: number, h: number, fill: (x: number, y: number) => number) {
  const pixels = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = fill(x, y);
      const i = (y * w + x) * 4;
      pixels[i] = a;
      pixels[i + 1] = a;
      pixels[i + 2] = a;
      pixels[i + 3] = a;
    }
  }
  return pixels;
}

describe("findSignificantAlphaBounds", () => {
  it("ignores sparse low-alpha fringe that findAlphaBounds would keep", () => {
    const w = 200;
    const h = 100;
    const pixels = rgba(w, h, (x, y) => {
      if (x >= 20 && x <= 120 && y >= 20 && y <= 80) return 220;
      if ((x === 180 || x === 181) && (y === 50 || y === 51)) return 24;
      return 0;
    });

    const loose = findAlphaBounds(pixels, w, h, 8);
    expect(loose?.maxX).toBe(181);

    const tight = findSignificantAlphaBounds(pixels, w, h);
    expect(tight?.minX).toBe(20);
    expect(tight?.maxX).toBe(120);
  });

  it("keeps soft edges when enough pixels exceed export threshold", () => {
    const w = 80;
    const h = 60;
    const pixels = rgba(w, h, (x, y) => {
      if (x >= 10 && x <= 50 && y >= 10 && y <= 50) return 40;
      return 0;
    });

    const bounds = findSignificantAlphaBounds(pixels, w, h);
    expect(bounds?.minX).toBe(10);
    expect(bounds?.maxX).toBe(50);
  });

  it("strips sparse edge columns after thresholding", () => {
    const w = 100;
    const h = 40;
    const pixels = rgba(w, h, (x, y) => {
      if (x >= 5 && x <= 70 && y >= 8 && y <= 30) return 255;
      if (x === 71 && y >= 10 && y <= 12) return 255;
      return 0;
    });

    const bounds = findSignificantAlphaBounds(pixels, w, h, {
      alphaThreshold: 8,
      minEdgeOpaque: EXPORT_BOUNDS_MIN_EDGE_OPAQUE,
    });
    expect(bounds?.maxX).toBe(70);
  });

  it("uses export defaults aligned with pet_export.py spirit", () => {
    expect(EXPORT_BOUNDS_ALPHA_THRESHOLD).toBeGreaterThan(8);
    expect(EXPORT_BOUNDS_MIN_EDGE_OPAQUE).toBeGreaterThanOrEqual(3);
  });
});
