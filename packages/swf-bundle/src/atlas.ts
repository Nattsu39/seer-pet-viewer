import type { FitRgbaResult } from "./max-texture-size.js";

export interface AtlasPixels {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

export interface PreparedAtlasBitmap {
  bitmap: ImageBitmap;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  scaled: boolean;
}

/** unity-js 解码行序与 UnityPy/atlas.png 相反，需翻转为与 swfclip 一致 */
export function flipAtlasY(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba.length);
  const row = width * 4;
  for (let y = 0; y < height; y++) {
    out.set(rgba.subarray(y * row, y * row + row), (height - 1 - y) * row);
  }
  return out;
}

/** 透明像素 RGB 清零，避免线性过滤在直通 alpha 图集边缘采到有色脏边 */
export function zeroTransparentRgb(rgba: Uint8ClampedArray): void {
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3]! === 0) {
      rgba[i] = 0;
      rgba[i + 1] = 0;
      rgba[i + 2] = 0;
    }
  }
}

/**
 * 将不透明边沿的 RGB 扩散进透明 padding（PMA 上传场景用）。
 * 直通 alpha + 线性过滤时不应使用，会加剧边缘暗边。
 */
export function bleedAtlasEdges(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  passes = 8,
  alphaThreshold = 8,
): void {
  const w = width;
  const h = height;
  const scratch = new Uint8ClampedArray(rgba.length);

  for (let pass = 0; pass < passes; pass++) {
    scratch.set(rgba);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (rgba[i + 3]! > alphaThreshold) continue;

        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
            const j = (ny * w + nx) * 4;
            if (rgba[j + 3]! > alphaThreshold) {
              r += rgba[j]!;
              g += rgba[j + 1]!;
              b += rgba[j + 2]!;
              n++;
            }
          }
        }
        if (n > 0) {
          scratch[i] = Math.round(r / n);
          scratch[i + 1] = Math.round(g / n);
          scratch[i + 2] = Math.round(b / n);
        }
      }
    }
    rgba.set(scratch);
  }
}

/** 直通 alpha 图集上传前：边缘色扩散，改善半透明边沿插值（对齐 Unity 图集 padding） */
export function prepareAtlasRgba(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): void {
  zeroTransparentRgb(rgba);
  bleedAtlasEdges(rgba, width, height, 2);
}

async function prepareAtlasRgbaOnly(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Promise<FitRgbaResult> {
  prepareAtlasRgba(rgba, width, height);
  return {
    rgba,
    width,
    height,
    scaled: false,
    originalWidth: width,
    originalHeight: height,
  };
}

export async function rgbaToImageBitmap(
  width: number,
  height: number,
  rgba: Uint8ClampedArray,
): Promise<ImageBitmap> {
  const imageData = new ImageData(new Uint8ClampedArray(rgba), width, height);
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(imageData, { premultiplyAlpha: "none" });
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建画布");
  ctx.putImageData(imageData, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error("图集 PNG 编码失败"));
    }, "image/png");
  });
  return createImageBitmap(blob, { premultiplyAlpha: "none" });
}

export async function atlasPixelsToBitmap(
  pixels: AtlasPixels,
): Promise<PreparedAtlasBitmap> {
  const data = new Uint8ClampedArray(pixels.rgba);
  const prepared = await prepareAtlasRgbaOnly(data, pixels.width, pixels.height);
  const bitmap = await rgbaToImageBitmap(
    prepared.width,
    prepared.height,
    prepared.rgba,
  );
  return {
    bitmap,
    width: prepared.width,
    height: prepared.height,
    originalWidth: prepared.originalWidth,
    originalHeight: prepared.originalHeight,
    scaled: prepared.scaled,
  };
}

export async function prepareAtlasBitmap(
  bitmap: ImageBitmap,
  width: number,
  height: number,
): Promise<PreparedAtlasBitmap> {
  const pixels = await readBitmapPixels(bitmap, width, height);
  bitmap.close?.();
  const prepared = await prepareAtlasRgbaOnly(pixels, width, height);
  const result = await rgbaToImageBitmap(
    prepared.width,
    prepared.height,
    prepared.rgba,
  );
  return {
    bitmap: result,
    width: prepared.width,
    height: prepared.height,
    originalWidth: prepared.originalWidth,
    originalHeight: prepared.originalHeight,
    scaled: prepared.scaled,
  };
}

export async function readBitmapPixels(
  bitmap: ImageBitmap,
  width: number,
  height: number,
): Promise<Uint8ClampedArray> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("无法读取图集像素");
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, width, height).data;
}
