import {
  fitRgbaToMaxTextureSize,
  getMaxTextureSize,
  type FitRgbaResult,
} from "./max-texture-size.js";

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

/** 解析 Spine atlas 页级 `pma:true/false`（默认 true，与 Spine 导出惯例一致） */
export function parseAtlasUsesPma(atlasText: string): boolean {
  const match = atlasText.match(/^pma:\s*(true|false)\s*$/im);
  if (!match) return true;
  return match[1]!.toLowerCase() === "true";
}

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

/** 透明像素 RGB 清零，避免 PMA + 线性过滤在图集块边界采到脏色 */
export function zeroTransparentRgb(rgba: Uint8ClampedArray): void {
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3]! === 0) {
      rgba[i] = 0;
      rgba[i + 1] = 0;
      rgba[i + 2] = 0;
    }
  }
}

/** 将不透明边沿 RGB 扩散进透明 padding，减轻 Linear 过滤暗边 */
export function bleedAtlasEdges(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  passes = 2,
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

/** PMA 纹理：保证 RGB 不超过 alpha，避免直通色被当作 PMA 时边缘发黑 */
export function clampPmaRgb(rgba: Uint8ClampedArray): void {
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3]!;
    if (a <= 0) continue;
    rgba[i] = Math.min(rgba[i]!, a);
    rgba[i + 1] = Math.min(rgba[i + 1]!, a);
    rgba[i + 2] = Math.min(rgba[i + 2]!, a);
  }
}

export function prepareSpineAtlasRgba(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  pma: boolean,
): void {
  zeroTransparentRgb(rgba);
  if (pma) {
    // PMA 图集：padding 必须保持 (0,0,0,0)；色扩散仅适用于直通 alpha（见 SWF prepareAtlasRgba）
    clampPmaRgb(rgba);
  } else {
    bleedAtlasEdges(rgba, width, height, 2);
  }
}

async function prepareAndFitSpineAtlasRgba(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  pma: boolean,
  maxSide = getMaxTextureSize(),
): Promise<FitRgbaResult> {
  prepareSpineAtlasRgba(rgba, width, height, pma);
  return fitRgbaToMaxTextureSize(rgba, width, height, maxSide);
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
      else reject(new Error("纹理 PNG 编码失败"));
    }, "image/png");
  });
  return createImageBitmap(blob, { premultiplyAlpha: "none" });
}

export async function atlasPixelsToBitmap(
  pixels: AtlasPixels,
  options: { pma?: boolean } = {},
): Promise<PreparedAtlasBitmap> {
  const pma = options.pma ?? true;
  const data = new Uint8ClampedArray(pixels.rgba);
  const fitted = await prepareAndFitSpineAtlasRgba(
    data,
    pixels.width,
    pixels.height,
    pma,
  );
  const bitmap = await rgbaToImageBitmap(
    fitted.width,
    fitted.height,
    fitted.rgba,
  );
  return {
    bitmap,
    width: fitted.width,
    height: fitted.height,
    originalWidth: fitted.originalWidth,
    originalHeight: fitted.originalHeight,
    scaled: fitted.scaled,
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
  if (!ctx) throw new Error("无法读取纹理像素");
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, width, height).data;
}

export async function prepareSpineAtlasBitmap(
  bitmap: ImageBitmap,
  width: number,
  height: number,
  pma: boolean,
): Promise<PreparedAtlasBitmap> {
  const pixels = await readBitmapPixels(bitmap, width, height);
  bitmap.close?.();
  const fitted = await prepareAndFitSpineAtlasRgba(pixels, width, height, pma);
  const prepared = await rgbaToImageBitmap(
    fitted.width,
    fitted.height,
    fitted.rgba,
  );
  return {
    bitmap: prepared,
    width: fitted.width,
    height: fitted.height,
    originalWidth: fitted.originalWidth,
    originalHeight: fitted.originalHeight,
    scaled: fitted.scaled,
  };
}

export function imgBitMapToPixels(img: {
  data: ArrayBuffer;
  width: number;
  height: number;
}): AtlasPixels {
  const rgba = flipAtlasY(
    new Uint8ClampedArray(img.data),
    img.width,
    img.height,
  );
  return { width: img.width, height: img.height, rgba };
}
