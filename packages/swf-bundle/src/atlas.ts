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

/**
 * unity-js 解码行序与 UnityPy/atlas.png 相反，需翻转为与 swfclip 一致。
 * 就地交换行，只额外分配一行（8192 图集为 32 KiB 而非 256 MiB）。
 * 调用方必须独占 `rgba`：翻转后原始行序不再可用。
 */
export function flipAtlasYInPlace(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8ClampedArray {
  const row = width * 4;
  const swap = new Uint8ClampedArray(row);
  for (let top = 0, bottom = height - 1; top < bottom; top++, bottom--) {
    const topStart = top * row;
    const bottomStart = bottom * row;
    swap.set(rgba.subarray(topStart, topStart + row));
    rgba.copyWithin(topStart, bottomStart, bottomStart + row);
    rgba.set(swap, bottomStart);
  }
  return rgba;
}

/** 保留原数组的翻转（需要同时持有两种行序时用），会复制一份整图 */
export function flipAtlasY(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8ClampedArray {
  return flipAtlasYInPlace(new Uint8ClampedArray(rgba), width, height);
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
 *
 * 就地写入：本算法只读取 alpha > 阈值的像素、只写入 alpha <= 阈值的像素，
 * 两个集合互不相交且 alpha 从不改变，因此不需要整图 scratch，
 * 也因此第二轮及以后的 pass 只会重算出与第一轮相同的结果（`passes` 仅作兼容保留）。
 */
export function bleedAtlasEdges(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  passes = 8,
  alphaThreshold = 8,
): void {
  if (passes < 1) return;
  const w = width;
  const h = height;

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
        rgba[i] = Math.round(r / n);
        rgba[i + 1] = Math.round(g / n);
        rgba[i + 2] = Math.round(b / n);
      }
    }
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

/**
 * ImageData 要求 data.length === width*height*4，且不会复制传入的数组。
 * 因此这里只做零拷贝视图收窄，绝不再复制一份整图。
 */
function exactPixelView(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8ClampedArray<ArrayBuffer> {
  const expected = width * height * 4;
  const data = rgba as Uint8ClampedArray<ArrayBuffer>;
  if (data.length === expected) return data;
  if (data.length > expected) {
    return new Uint8ClampedArray(data.buffer, data.byteOffset, expected);
  }
  throw new Error(
    `图集像素数据不足：${data.length} < ${expected}（${width}×${height}）`,
  );
}

export async function rgbaToImageBitmap(
  width: number,
  height: number,
  rgba: Uint8ClampedArray,
): Promise<ImageBitmap> {
  // createImageBitmap 解析期间不得再修改 rgba：调用方在此之后不应复用该 buffer。
  const imageData = new ImageData(
    exactPixelView(rgba, width, height),
    width,
    height,
  );
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
  // 非 clamped 输入只换视图类型，不复制整图（8192 图集一份就是 256 MiB）
  const source = pixels.rgba as Uint8Array | Uint8ClampedArray;
  const data =
    source instanceof Uint8ClampedArray
      ? source
      : new Uint8ClampedArray(
          source.buffer,
          source.byteOffset,
          source.byteLength,
        );
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
