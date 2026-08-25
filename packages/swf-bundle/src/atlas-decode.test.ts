import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadAssetBundle } from "@arkntools/unity-js";
import {
  canDecodeAtlasStrips,
  captureAtlasTextureSource,
  decodeAtlasFromSource,
  decodeAtlasWhole,
  findAtlasTexture,
} from "./atlas-decode.js";

const root = resolve(import.meta.dirname, "../../..");

function loadTexture(bundlePath: string) {
  const buf = readFileSync(bundlePath);
  const buffer = buf.buffer.slice(
    buf.byteOffset,
    buf.byteOffset + buf.byteLength,
  ) as ArrayBuffer;
  return loadAssetBundle(buffer).then((bundle) => {
    const texture = findAtlasTexture(bundle);
    if (!texture) throw new Error("未找到 Texture2D");
    return { texture, source: captureAtlasTextureSource(texture) };
  });
}

function asBuffer(view: Uint8ClampedArray): Buffer {
  return Buffer.from(view.buffer, view.byteOffset, view.byteLength);
}

function expectRowsEqual(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  width: number,
  rows: number[],
): number {
  const row = width * 4;
  let nonZeroAlpha = 0;
  for (const r of rows) {
    const off = r * row;
    for (let i = 0; i < row; i += 4) {
      if (
        a[off + i] !== b[off + i] ||
        a[off + i + 1] !== b[off + i + 1] ||
        a[off + i + 2] !== b[off + i + 2] ||
        a[off + i + 3] !== b[off + i + 3]
      ) {
        throw new Error(`row ${r} px ${i / 4} 不一致`);
      }
      if (a[off + i + 3] !== 0) nonZeroAlpha++;
    }
  }
  return nonZeroAlpha;
}

describe("atlas-decode 条带解码奇偶性", () => {
  it(
    "ppets_4911 (BC7 8192²) 条带输出与整图回退一致（含条带边界行）",
    async () => {
      const { texture, source } = await loadTexture(
        resolve(root, "ppets_4911.bundle"),
      );
      expect(source.format).toBe(25); // BC7
      expect(canDecodeAtlasStrips(source)).toBe(true);

      // 整图回退会就地翻转 unity-js 的解码缓冲，因此先跑条带路径
      const stripped = decodeAtlasFromSource(source);
      expect(stripped, "条带路径应可用").not.toBeNull();

      const whole = decodeAtlasWhole(texture);
      expect(stripped!.width).toBe(whole.width);
      expect(stripped!.height).toBe(whole.height);
      expect(stripped!.rgba.length).toBe(whole.rgba.length);
      // 条带高 512 行：覆盖条带边界（511/512/513/1023/1024）与首尾行
      const nonZero = expectRowsEqual(
        stripped!.rgba,
        whole.rgba,
        whole.width,
        [0, 1, 511, 512, 513, 1023, 1024, 4095, 4096, 7680, 8190, 8191],
      );
      expect(nonZero, "采样行应有非透明像素").toBeGreaterThan(0);
    },
    120_000,
  );

  it(
    "RGBA32 直出：视图 + 就地翻转，不复制整图",
    () => {
      // 2×2 四个不同颜色的像素，RGBA32（format=4）原始数据
      const raw = new Uint8Array([
        1, 2, 3, 4, 5, 6, 7, 8,
        9, 10, 11, 12, 13, 14, 15, 16,
      ]);
      const source = {
        width: 2,
        height: 2,
        format: 4,
        raw,
        alreadyDecoded: false,
      };
      const decoded = decodeAtlasFromSource(source);
      expect(decoded).not.toBeNull();
      expect(decoded!.rgba.buffer).toBe(raw.buffer); // 零拷贝视图
      expect(Array.from(decoded!.rgba)).toEqual([
        9, 10, 11, 12, 13, 14, 15, 16,
        1, 2, 3, 4, 5, 6, 7, 8,
      ]);
    },
  );

  it("alreadyDecoded 的 source 不走条带/直出路径", () => {
    const source = {
      width: 1,
      height: 1,
      format: 25,
      raw: new Uint8Array(16),
      alreadyDecoded: true,
    };
    expect(canDecodeAtlasStrips(source)).toBe(false);
    expect(decodeAtlasFromSource(source)).toBeNull();
  });
});
