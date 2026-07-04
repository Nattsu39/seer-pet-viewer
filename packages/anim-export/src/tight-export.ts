import type { PixelRect } from "./alpha-bounds.js";
import {
  computeTightExportSize,
  cropRgbaPixels,
  findAlphaBounds,
  pixelRectHeight,
  pixelRectWidth,
  scalePixelRect,
  unionPixelRects,
} from "./alpha-bounds.js";
import { MAX_EXPORT_SIDE, type VertexBounds } from "./export-dimensions.js";

export interface FittedCanvasLayout {
  width: number;
  height: number;
  pixelsPerUnitX: number;
  pixelsPerUnitY: number;
}

/** 低分辨率探测画布最长边 */
export const PROBE_MAX_SIDE = 512;
export { MAX_EXPORT_SIDE } from "./export-dimensions.js";

/** 将包围盒均匀缩放装入 maxSide 画布 */
export function computeFittedCanvasLayout(
  bounds: VertexBounds,
  maxSide: number,
  pad = 2,
): FittedCanvasLayout {
  const pw = bounds.maxX - bounds.minX || 1;
  const ph = bounds.maxY - bounds.minY || 1;
  const avail = Math.max(1, maxSide - pad * 2);
  const uniformPpu = avail / Math.max(pw, ph);
  const innerW = pw * uniformPpu;
  const innerH = ph * uniformPpu;

  return {
    width: Math.max(1, Math.ceil(innerW) + pad * 2),
    height: Math.max(1, Math.ceil(innerH) + pad * 2),
    pixelsPerUnitX: uniformPpu,
    pixelsPerUnitY: uniformPpu,
  };
}

export function mergeAlphaBounds(
  pixels: Uint8Array,
  width: number,
  height: number,
  union: PixelRect | null,
  transparent: boolean,
): PixelRect | null {
  if (!transparent) {
    return unionPixelRects(union, {
      minX: 0,
      minY: 0,
      maxX: width - 1,
      maxY: height - 1,
    });
  }
  return unionPixelRects(union, findAlphaBounds(pixels, width, height));
}

export interface TightExportPlan {
  exportWidth: number;
  exportHeight: number;
  renderLayout: FittedCanvasLayout;
  cropRect: PixelRect;
  pixelScale: number;
}

/** @deprecated 使用 planReferenceExport（standby 参考缩放 + 1920 上限） */
export function planTightExport(
  alphaUnion: PixelRect,
  probe: FittedCanvasLayout,
  userScale: number,
  pad: number,
): TightExportPlan {
  const contentW = pixelRectWidth(alphaUnion);
  const contentH = pixelRectHeight(alphaUnion);
  const { width: exportWidth, height: exportHeight } = computeTightExportSize(
    { minX: 0, minY: 0, maxX: contentW - 1, maxY: contentH - 1 },
    userScale,
    pad,
    MAX_EXPORT_SIDE,
  );

  const innerW = Math.max(1, exportWidth - pad * 2);
  const innerH = Math.max(1, exportHeight - pad * 2);
  const pixelScale = Math.min(innerW / contentW, innerH / contentH);

  const renderLayout: FittedCanvasLayout = {
    width: Math.max(1, Math.ceil(probe.width * pixelScale)),
    height: Math.max(1, Math.ceil(probe.height * pixelScale)),
    pixelsPerUnitX: probe.pixelsPerUnitX * pixelScale,
    pixelsPerUnitY: probe.pixelsPerUnitY * pixelScale,
  };

  return {
    exportWidth,
    exportHeight,
    renderLayout,
    cropRect: alphaUnion,
    pixelScale,
  };
}

export function finalizeExportPixels(
  pixels: Uint8Array,
  renderWidth: number,
  renderHeight: number,
  plan: TightExportPlan,
  pad: number,
): Uint8Array {
  const scaledCrop = scalePixelRect(plan.cropRect, plan.pixelScale);
  const { pixels: cropped, width: cropW, height: cropH } = cropRgbaPixels(
    pixels,
    renderWidth,
    renderHeight,
    scaledCrop,
  );

  if (pad <= 0) {
    return cropped;
  }

  const out = new Uint8Array(plan.exportWidth * plan.exportHeight * 4);
  const srcRow = cropW * 4;
  for (let y = 0; y < cropH; y++) {
    const destOffset = ((y + pad) * plan.exportWidth + pad) * 4;
    out.set(cropped.subarray(y * srcRow, y * srcRow + srcRow), destOffset);
  }
  return out;
}
