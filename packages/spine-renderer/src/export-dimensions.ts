/** @deprecated 使用 @seer/anim-export 的 export-dimensions */
export {
  BASE_EXPORT_CANVAS,
  MAX_EXPORT_SIDE,
} from "@seer/anim-export";

/** SkeletonBinary.scale 把原始像素转换为骨架单位，导出时取倒数还原。 */
export function computeSpineNativePixelsPerUnit(skeletonScale: number): number {
  if (!Number.isFinite(skeletonScale) || skeletonScale <= 0) {
    throw new Error("Spine 资源缩放必须为有限正数");
  }
  return 1 / skeletonScale;
}
