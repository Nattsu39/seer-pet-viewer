import type { BattleViewportLayout } from "@seer/anim-export/capture";

export interface SwfExportRootTransform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
}

/**
 * 战斗视口导出时的 root 变换。导出到纹理用正 Y（readPixels 行翻转后与
 * 预览朝向一致），因此 y 取画布高度减去原点的顶部坐标；镜像由负的
 * scaleX 直接表达。
 */
export function computeSwfBattleExportRootTransform(
  layout: BattleViewportLayout,
): SwfExportRootTransform {
  return {
    x: layout.originX,
    y: layout.height - layout.originY,
    scaleX: layout.pixelsPerUnitX,
    scaleY: layout.pixelsPerUnitY,
  };
}
