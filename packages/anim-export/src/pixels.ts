import { MAX_EXPORT_SIDE } from "./export-dimensions.js";

/** 从可能共享大 buffer 的视图中复制紧凑 RGBA（gifenc 用 Uint32Array(rgba.buffer) 会误读全长） */
export function copyRgbaPixels(
  pixels: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const w = Math.floor(width);
  const h = Math.floor(height);
  if (w <= 0 || h <= 0 || w > MAX_EXPORT_SIDE || h > MAX_EXPORT_SIDE) {
    throw new Error(
      `导出尺寸过大 (${w}×${h})，请降低缩放倍数；最长边上限 ${MAX_EXPORT_SIDE}px`,
    );
  }
  const expected = w * h * 4;
  const out = new Uint8Array(expected);
  if (pixels.length < expected) {
    throw new Error(
      `像素数据不足: 需要 ${expected} 字节，实际 ${pixels.length} 字节 (${w}×${h})`,
    );
  }
  out.set(pixels.subarray(0, expected));
  return out;
}

/** 纵向翻转 RGBA（顶左原点） */
export function flipRgbaY(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): Uint8Array {
  const rowBytes = width * 4;
  const out = new Uint8Array(pixels.length);
  for (let y = 0; y < height; y++) {
    const srcRow = (height - 1 - y) * rowBytes;
    out.set(pixels.subarray(srcRow, srcRow + rowBytes), y * rowBytes);
  }
  return out;
}

/** @deprecated 使用 flipRgbaY */
export function flipPixelsY(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8ClampedArray {
  return new Uint8ClampedArray(flipRgbaY(pixels, width, height));
}

/** Spine / WebGL 预乘 alpha → 直通 alpha 供编码器使用 */
export function unpremultiplyPixels(pixels: Uint8ClampedArray): void {
  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3]! / 255;
    if (a <= 0) {
      pixels[i] = 0;
      pixels[i + 1] = 0;
      pixels[i + 2] = 0;
      continue;
    }
    if (a >= 1) continue;
    pixels[i] = Math.min(255, Math.round(pixels[i]! / a));
    pixels[i + 1] = Math.min(255, Math.round(pixels[i + 1]! / a));
    pixels[i + 2] = Math.min(255, Math.round(pixels[i + 2]! / a));
  }
}
