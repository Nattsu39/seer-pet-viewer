import { describe, expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import { BitReader, Reader, signedBits, u16 } from "./binary.js";
import { bitmap, bitmapShape, colorTransform, encodeTag, end, matrix, readSwf, readTags,
  rect, showFrame, sprite, writeSwf } from "./swf.js";
import { quadMatrix, unpackColor } from "./rebuild.js";

describe("SWF binary encoding", () => {
  it("writes premultiplied ARGB rather than straight RGBA", () => {
    const tag = bitmap(7, 2, 1, Uint8Array.from([200, 100, 50, 128, 255, 20, 40, 0]));
    expect(tag.code).toBe(36);
    expect([...inflateSync(tag.data.subarray(7))]).toEqual([128, 100, 50, 25, 0, 0, 0, 0]);
    const encoded = encodeTag(bitmap(8, 1, 1, Uint8Array.from([0, 0, 0, 0])));
    expect(encoded.readUInt16LE() & 63).toBe(63);
  });

  it("encodes scale, skew and signed twip translation in SWF field order", () => {
    const bits = new BitReader(matrix([0.5, -0.25, 0.125, 2, -4427, 2497]));
    expect(bits.read(1)).toBe(1);
    let count = bits.read(5);
    expect([bits.read(count, true), bits.read(count, true)]).toEqual([32768, 131072]);
    expect(bits.read(1)).toBe(1);
    count = bits.read(5);
    expect([bits.read(count, true), bits.read(count, true)]).toEqual([-16384, 8192]);
    count = bits.read(5);
    expect([bits.read(count, true), bits.read(count, true)]).toEqual([-4427, 2497]);
  });

  it("preserves signed color offsets and the multiplier/addition order", () => {
    const bits = new BitReader(colorTransform([1, 0.5, 0, 1], [-0.2, 0, 1, 0]));
    expect(bits.read(2)).toBe(3);
    const count = bits.read(4);
    expect(Array.from({ length: 8 }, () => bits.read(count, true))).toEqual([256, 128, 0, 256, -51, 0, 255, 0]);
    expect(unpackColor(0xff000200, 0x00000200)).toEqual([-0.5, 1, 0, 1]);
  });

  it("round-trips compressed headers and nested timelines", () => {
    const file = { version: 15, header: Buffer.concat([rect([0, 19200, 0, 11200]), u16(24 * 256), u16(1)]),
      tags: [bitmapShape(2, 1, 4096, 4096), sprite(3, [[], []]), showFrame(), end()] };
    const bytes = writeSwf(file);
    const decoded = readSwf(bytes);
    expect(decoded).toEqual(file);
    expect(readTags(decoded.tags[1].data.subarray(4)).map((tag) => tag.code)).toEqual([1, 1, 0]);
    const bad = Buffer.from(bytes); bad.writeUInt32LE(9, 4);
    expect(() => readSwf(bad)).toThrow("length mismatch");
    expect(() => readTags(Buffer.from([0xff, 0xff]))).toThrow("Truncated");
    expect(() => readTags(Buffer.from([0, 0, 1]))).toThrow("trailing");
    expect(() => signedBits([Infinity])).toThrow("finite");
    expect(() => new Reader(Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff])).encoded()).toThrow("Invalid");
  });

  it("calibrates the audited 4944 first quad against the retained Flash placement", () => {
    const transform = quadMatrix([
      { x: -0.1570001244544983, y: 2.0864999294281006 },
      { x: 0.5779699683189392, y: 2.0864999294281006 },
      { x: 0.5779699683189392, y: 1.5780205726623535 },
      { x: -0.1570001244544983, y: 1.5780205726623535 },
    ], 490, 339, 100, [4427, 2497]);
    // 原始 Sprite 144 使用此缩放和位移放置位图 9。
    expect(transform[0]).toBeCloseTo(0.149993896484375, 6);
    expect(transform[3]).toBeCloseTo(0.149993896484375, 6);
    expect(transform[4]).toBeCloseTo(4113, 2);
    expect(transform[5]).toBeCloseTo(-1676, 2);
    expect(() => quadMatrix([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 1 }], 1, 1, 100))
      .toThrow("Non-affine");
  });
});
