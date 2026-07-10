const DEFAULT_MAX_TEXTURE_SIZE = 4096;

let cachedMaxTextureSize: number | null = null;

/** 查询 WebGL MAX_TEXTURE_SIZE；无 GL 环境时回退 4096 */
export function getMaxTextureSize(): number {
  if (cachedMaxTextureSize !== null) return cachedMaxTextureSize;

  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl2") ??
      canvas.getContext("webgl") ??
      canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (gl) {
      const glMax = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
      cachedMaxTextureSize = Math.min(glMax, DEFAULT_MAX_TEXTURE_SIZE);
      return cachedMaxTextureSize;
    }
  }

  cachedMaxTextureSize = DEFAULT_MAX_TEXTURE_SIZE;
  return cachedMaxTextureSize;
}

/** 测试用：重置缓存的上限值 */
export function resetMaxTextureSizeCache(): void {
  cachedMaxTextureSize = null;
}

export interface FitTextureSize {
  width: number;
  height: number;
  scale: number;
}

export function computeFitTextureSize(
  width: number,
  height: number,
  maxSide: number,
): FitTextureSize {
  if (width <= maxSide && height <= maxSide) {
    return { width, height, scale: 1 };
  }
  const scale = Math.min(maxSide / width, maxSide / height);
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
    scale,
  };
}

export interface FitRgbaResult {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  scaled: boolean;
  originalWidth: number;
  originalHeight: number;
}

function downscaleRgbaNearest(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  targetWidth: number,
  targetHeight: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(targetWidth * targetHeight * 4);
  for (let y = 0; y < targetHeight; y++) {
    const srcY = Math.min(
      height - 1,
      Math.floor((y * height) / targetHeight),
    );
    for (let x = 0; x < targetWidth; x++) {
      const srcX = Math.min(
        width - 1,
        Math.floor((x * width) / targetWidth),
      );
      const srcI = (srcY * width + srcX) * 4;
      const dstI = (y * targetWidth + x) * 4;
      out[dstI] = rgba[srcI]!;
      out[dstI + 1] = rgba[srcI + 1]!;
      out[dstI + 2] = rgba[srcI + 2]!;
      out[dstI + 3] = rgba[srcI + 3]!;
    }
  }
  return out;
}

async function resizeRgba(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  targetWidth: number,
  targetHeight: number,
): Promise<Uint8ClampedArray> {
  if (
    typeof createImageBitmap !== "function" ||
    typeof ImageData === "undefined"
  ) {
    return downscaleRgbaNearest(
      rgba,
      width,
      height,
      targetWidth,
      targetHeight,
    );
  }

  const imageData = new ImageData(new Uint8ClampedArray(rgba), width, height);
  const source = await createImageBitmap(imageData, { premultiplyAlpha: "none" });
  const resized = await createImageBitmap(source, {
    resizeWidth: targetWidth,
    resizeHeight: targetHeight,
    resizeQuality: "high",
    premultiplyAlpha: "none",
  });
  source.close();

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    resized.close();
    return downscaleRgbaNearest(
      rgba,
      width,
      height,
      targetWidth,
      targetHeight,
    );
  }
  ctx.drawImage(resized, 0, 0);
  resized.close();
  return ctx.getImageData(0, 0, targetWidth, targetHeight).data;
}

export async function fitRgbaToMaxTextureSize(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  maxSide = getMaxTextureSize(),
): Promise<FitRgbaResult> {
  const fit = computeFitTextureSize(width, height, maxSide);
  if (fit.scale === 1) {
    return {
      rgba,
      width,
      height,
      scaled: false,
      originalWidth: width,
      originalHeight: height,
    };
  }
  const scaledRgba = await resizeRgba(
    rgba,
    width,
    height,
    fit.width,
    fit.height,
  );
  return {
    rgba: scaledRgba,
    width: fit.width,
    height: fit.height,
    scaled: true,
    originalWidth: width,
    originalHeight: height,
  };
}

export function atlasDownscaleWarning(
  originalWidth: number,
  originalHeight: number,
  width: number,
  height: number,
  maxSide: number,
): string {
  return `图集已从 ${originalWidth}×${originalHeight} 缩放至 ${width}×${height}（设备纹理上限 ${maxSide}px）`;
}

export function atlasTileWarning(
  width: number,
  height: number,
  maxSide: number,
): string {
  return `图集 ${width}×${height} 超过设备纹理上限 ${maxSide}px，渲染时将分块加载`;
}
