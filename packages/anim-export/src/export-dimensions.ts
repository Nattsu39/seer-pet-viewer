import {
  cropRgbaPixels,
  DEFAULT_ALPHA_THRESHOLD,
  findAlphaBounds,
  unionPixelRects,
  type PixelRect,
} from "./alpha-bounds.js";

export interface VertexBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const BASE_EXPORT_CANVAS = 768;
export const MAX_EXPORT_SIDE = 1920;
export const EXPORT_PADDING = 16;
export const TIGHT_CROP_PADDING = 4;
export const REFERENCE_SEQUENCE = "standby";
export const REFERENCE_SEQUENCE_FALLBACKS = ["await"] as const;

export interface ReferenceExportLayout {
  width: number;
  height: number;
  scale: number;
  padding: number;
  pixelsPerUnitX: number;
  pixelsPerUnitY: number;
}

export interface RgbaFrame {
  pixels: Uint8Array;
  width: number;
  height: number;
}

export function resolveReferenceSequence(names: readonly string[]): string {
  if (names.includes(REFERENCE_SEQUENCE)) return REFERENCE_SEQUENCE;
  for (const fallback of REFERENCE_SEQUENCE_FALLBACKS) {
    if (names.includes(fallback)) return fallback;
  }
  return names[0] ?? REFERENCE_SEQUENCE;
}

export function computeReferenceScale(
  bounds: VertexBounds,
  baseCanvas = BASE_EXPORT_CANVAS,
  padding = EXPORT_PADDING,
): number {
  const span = Math.max(
    bounds.maxX - bounds.minX,
    bounds.maxY - bounds.minY,
    1e-6,
  );
  return (baseCanvas - padding * 2) / span;
}

export function computeVertexCanvasSize(
  bounds: VertexBounds,
  scale: number,
  padding = EXPORT_PADDING,
): { width: number; height: number } {
  const width =
    Math.ceil((bounds.maxX - bounds.minX) * scale) + padding * 2;
  const height =
    Math.ceil((bounds.maxY - bounds.minY) * scale) + padding * 2;
  return {
    width: Math.max(width, 1),
    height: Math.max(height, 1),
  };
}

export function fitCanvas(
  canvasW: number,
  canvasH: number,
  scale: number,
  maxCanvas: number,
): { width: number; height: number; scale: number } {
  if (maxCanvas <= 0) {
    return { width: canvasW, height: canvasH, scale };
  }
  const maxSide = Math.max(canvasW, canvasH);
  if (maxSide <= maxCanvas) {
    return { width: canvasW, height: canvasH, scale };
  }
  const ratio = maxCanvas / maxSide;
  return {
    width: Math.max(Math.floor(canvasW * ratio), 1),
    height: Math.max(Math.floor(canvasH * ratio), 1),
    scale: scale * ratio,
  };
}

export function planReferenceExport(
  bounds: VertexBounds,
  refScale: number,
  userScale: number,
  maxSide = MAX_EXPORT_SIDE,
  padding = EXPORT_PADDING,
): ReferenceExportLayout {
  const effectiveScale = refScale * userScale;
  const raw = computeVertexCanvasSize(bounds, effectiveScale, padding);
  const fitted = fitCanvas(raw.width, raw.height, effectiveScale, maxSide);
  return {
    width: fitted.width,
    height: fitted.height,
    scale: fitted.scale,
    padding,
    pixelsPerUnitX: fitted.scale,
    pixelsPerUnitY: fitted.scale,
  };
}

function expandPixelRect(
  rect: PixelRect,
  padding: number,
  maxW: number,
  maxH: number,
): PixelRect {
  return {
    minX: Math.max(0, rect.minX - padding),
    minY: Math.max(0, rect.minY - padding),
    maxX: Math.min(maxW - 1, rect.maxX + padding),
    maxY: Math.min(maxH - 1, rect.maxY + padding),
  };
}

export function tightCropRgbaFrames(
  frames: RgbaFrame[],
  cropPadding = TIGHT_CROP_PADDING,
  alphaThreshold = DEFAULT_ALPHA_THRESHOLD,
): RgbaFrame[] {
  let union: PixelRect | null = null;
  for (const frame of frames) {
    union = unionPixelRects(
      union,
      findAlphaBounds(frame.pixels, frame.width, frame.height, alphaThreshold),
    );
  }
  if (!union) return frames;

  return frames.map((frame) => {
    const cropRect = expandPixelRect(
      union!,
      cropPadding,
      frame.width,
      frame.height,
    );
    const cropped = cropRgbaPixels(
      frame.pixels,
      frame.width,
      frame.height,
      cropRect,
    );
    return {
      pixels: cropped.pixels,
      width: cropped.width,
      height: cropped.height,
    };
  });
}
