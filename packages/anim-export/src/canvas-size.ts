import type { ExportFormat, ExportViewport, ExportViewportCrop } from "./types.js";

export const MAX_ANIMATION_FRAME_SIDE = 4096;
export const MAX_PNG_FRAME_SIDE = 16384;
/** 通用像素处理允许的最大边长；具体导出格式在捕获前应用自己的上限。 */
export const MAX_FRAME_SIDE = MAX_PNG_FRAME_SIDE;

export function getExportMaxSide(format: ExportFormat | "png-sequence"): number {
  return format === "png-sequence" ? MAX_PNG_FRAME_SIDE : MAX_ANIMATION_FRAME_SIDE;
}

/** 两个轴分别截断，不改变内容倍率或另一条未超限的边。 */
export function cropCanvasSize(requested: ExportViewport, maxSide: number): {
  width: number;
  height: number;
  crop?: ExportViewportCrop;
} {
  validateCanvasSize(requested.width, requested.height, 0);
  if (maxSide !== 0 && (!Number.isSafeInteger(maxSide) || maxSide < 1)) {
    throw new Error("无效导出尺寸上限");
  }
  const width = maxSide > 0 ? Math.min(requested.width, maxSide) : requested.width;
  const height = maxSide > 0 ? Math.min(requested.height, maxSide) : requested.height;
  return {
    width,
    height,
    ...(width !== requested.width || height !== requested.height
      ? { crop: { requested: { ...requested }, output: { width, height }, maxSide } }
      : {}),
  };
}

export function validateCanvasSize(width: number, height: number, maxSide = MAX_FRAME_SIDE): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`无效导出尺寸 (${width}×${height})`);
  }
  if (maxSide > 0 && (width > maxSide || height > maxSide)) {
    throw new Error(`捕获帧尺寸 ${width}×${height} 超过 ${maxSide}px 上限，捕获源必须先裁剪视口`);
  }
}
