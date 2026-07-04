export {
  computeTightExportSize,
  cropRgbaPixels,
  findAlphaBounds,
  pixelRectHeight,
  pixelRectWidth,
  scalePixelRect,
  unionPixelRects,
  DEFAULT_ALPHA_THRESHOLD,
} from "./alpha-bounds.js";
export type { PixelRect } from "./alpha-bounds.js";
export {
  BASE_EXPORT_CANVAS,
  EXPORT_PADDING,
  MAX_EXPORT_SIDE,
  MAX_LAYOUT_ASPECT,
  REFERENCE_SEQUENCE,
  REFERENCE_SEQUENCE_FALLBACKS,
  TIGHT_CROP_PADDING,
  capLayoutVertexBounds,
  computeReferenceScale,
  computeVertexCanvasSize,
  fitCanvas,
  planReferenceExport,
  resolveReferenceSequence,
  tightCropRgbaFrames,
} from "./export-dimensions.js";
export type {
  ReferenceExportLayout,
  RgbaFrame,
  VertexBounds,
} from "./export-dimensions.js";
export {
  computeFittedCanvasLayout,
  finalizeExportPixels,
  mergeAlphaBounds,
  planTightExport,
  PROBE_MAX_SIDE,
} from "./tight-export.js";
export type { FittedCanvasLayout, TightExportPlan } from "./tight-export.js";
