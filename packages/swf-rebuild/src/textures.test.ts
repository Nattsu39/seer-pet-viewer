import { describe, expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import { BitReader } from "./binary.js";
import { ResourceDictionary } from "./resources.js";
import { bitmap, bitmapShape, matrix, rect } from "./swf.js";
import { validateTextureScale } from "./textures.js";

describe("reduced texture resolution", () => {
  it("averages premultiplied pixels without leaking transparent RGB or premultiplying twice", () => {
    const tag = bitmap(
      1,
      2,
      2,
      Uint8Array.from([
        255, 0, 0, 255, 0, 255, 0, 0, 200, 100, 50, 128, 0, 0, 255, 0,
      ]),
      0.5,
    );
    expect(tag.data.readUInt16LE(3)).toBe(1);
    expect(tag.data.readUInt16LE(5)).toBe(1);
    expect([...inflateSync(tag.data.subarray(7))]).toEqual([96, 89, 13, 6]);
  });

  it("keeps partial blocks at odd edges and never produces zero-sized bitmaps", () => {
    const pixels = Uint8Array.from(
      [10, 20, 30, 40, 50, 60, 70, 80, 90].flatMap((red) => [red, 0, 0, 255]),
    );
    const half = bitmap(1, 3, 3, pixels, 0.5);
    expect(half.data.readUInt16LE(3)).toBe(2);
    expect(half.data.readUInt16LE(5)).toBe(2);
    expect([...inflateSync(half.data.subarray(7))]).toEqual([
      255, 30, 0, 0, 255, 45, 0, 0, 255, 75, 0, 0, 255, 90, 0, 0,
    ]);
    const quarter = bitmap(1, 3, 3, pixels, 0.25);
    expect(quarter.data.readUInt16LE(3)).toBe(1);
    expect(quarter.data.readUInt16LE(5)).toBe(1);
    expect([...inflateSync(quarter.data.subarray(7))]).toEqual([255, 50, 0, 0]);
    const single = bitmap(1, 1, 1, pixels.subarray(0, 4), 0.25);
    expect([...inflateSync(single.data.subarray(7))]).toEqual([255, 10, 0, 0]);
  });

  it("compensates the fill matrix while preserving shape bounds and edges", () => {
    const full = bitmapShape(2, 1, 3, 5).data;
    const half = bitmapShape(2, 1, 3, 5, 2, 3).data;
    const offset = 2 + rect([0, 60, 0, 100]).length + 4;
    expect(half.subarray(0, offset)).toEqual(full.subarray(0, offset));
    const fill = matrix([30, 0, 0, 100 / 3, 0, 0]);
    expect(half.subarray(offset, offset + fill.length)).toEqual(fill);
    const bits = new BitReader(half.subarray(offset));
    expect(bits.read(1)).toBe(1);
    const count = bits.read(5);
    expect(bits.read(count, true)).toBe(30 * 65536);
    expect(bits.read(count, true)).toBe(Math.round((100 / 3) * 65536));
    expect(half.subarray(offset + fill.length)).toEqual(
      full.subarray(offset + matrix([20, 0, 0, 20, 0, 0]).length),
    );
  });

  it("preserves logical regions and mask geometry, counting each bitmap only once", () => {
    const atlas = { width: 3, height: 3, rgba: Buffer.alloc(36, 255) };
    atlas.rgba[19] = 0; // 全分辨率遮罩中的一个透明孔洞。
    const full = new ResourceDictionary(atlas, 1);
    const half = new ResourceDictionary(atlas, 1, 0.5);
    expect(half.region(0, 0xffffffff)).toEqual(full.region(0, 0xffffffff));
    half.region(0, 0xffffffff);
    expect(half.bitmapPixelBytes).toBe(16);
    expect(half.originalBitmapPixelBytes).toBe(36);
    expect(half.tags).toHaveLength(2);
    expect(half.mask(0, 0xffffffff)).toEqual(full.mask(0, 0xffffffff));
    expect(half.tags.at(-1)).toEqual(full.tags.at(-1));
  });

  it("rejects unsupported scales", () => {
    for (const scale of [0, -1, 2, 0.3, NaN, Infinity]) {
      expect(() => validateTextureScale(scale)).toThrow(
        "Texture scale must be",
      );
    }
  });
});
