import {
  applyPalette as applyPaletteRaw,
  prequantize as prequantizeRaw,
  quantize as quantizeRaw,
} from "gifenc";

type RgbaInput = Uint8Array | Uint8ClampedArray;
type QuantizeOptions = Parameters<typeof quantizeRaw>[2];
type Palette = Parameters<typeof applyPaletteRaw>[1];
type PixelFormat = Parameters<typeof applyPaletteRaw>[2];
type GifPixelFormat = "rgb565" | "rgba4444";

/**
 * gifenc 用 `new Uint32Array(rgba.buffer)` 读取整块 ArrayBuffer，
 * Pixi extract 等返回的视图会挂在大块 GPU/canvas buffer 上导致崩溃。
 */
export function tightRgbaForGifenc(
  pixels: RgbaInput,
  width: number,
  height: number,
): Uint8ClampedArray {
  const w = Math.floor(width);
  const h = Math.floor(height);
  const byteLen = w * h * 4;
  const out = new Uint8ClampedArray(byteLen);
  out.set(pixels.subarray(0, byteLen));
  return out;
}

export function quantize(
  pixels: RgbaInput,
  width: number,
  height: number,
  maxColors: number,
  opts?: QuantizeOptions,
) {
  return quantizeRaw(
    tightRgbaForGifenc(pixels, width, height),
    maxColors,
    opts,
  );
}

export function applyPalette(
  pixels: RgbaInput,
  width: number,
  height: number,
  palette: Palette,
  format?: PixelFormat,
) {
  return applyPaletteRaw(
    tightRgbaForGifenc(pixels, width, height),
    palette,
    format,
  );
}

/**
 * 将 RGB 对齐到较粗色阶，抑制线性过滤造成的逐帧调色盘索引跳动（GIF 闪烁）。
 */
export function prequantizeForGif(
  pixels: RgbaInput,
  width: number,
  height: number,
  format: GifPixelFormat,
  useAlpha: boolean,
): Uint8ClampedArray {
  const tight = tightRgbaForGifenc(pixels, width, height);
  prequantizeRaw(tight, {
    roundRGB: format === "rgba4444" ? 17 : 8,
    roundAlpha: useAlpha ? 128 : 10,
    oneBitAlpha: useAlpha ? 127 : null,
  });
  return tight;
}
