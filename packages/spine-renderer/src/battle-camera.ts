import type { BattleViewportLayout } from "@seer/anim-export/capture";

export interface FixedPlacementTransform {
  /** 内容原点在画布上的 CSS 像素位置（y 向下，屏幕约定） */
  position: { x: number; y: number };
  /** 画布 CSS 像素/内容单位；x 为负表示镜像（y 幅值与 x 相同，相机各向同性） */
  scale: { x: number; y: number };
}

/** spine 相机参数：zoom = 世界单位/像素（越大越远），y 向上 */
export interface SpineCameraParams {
  zoom: number;
  x: number;
  y: number;
}

/**
 * fixed 模式预览相机：内容原点落在 position（画布 CSS 像素，y 向下）。
 * spine 相机 zoom 语义与 Pixi scale 相反（单位/像素），故取倒数；
 * spine-webgl 相机视口是 backing-store 像素，CSS 像素需按 pixelRatio
 * 换算，否则 dpr>1 时内容会缩小 dpr 倍。
 * 镜像不通过相机而由 skeleton.scaleX 表达。
 */
export function computeSpineFixedCamera(
  transform: FixedPlacementTransform,
  canvasWidth: number,
  canvasHeight: number,
  pixelRatio = 1,
): SpineCameraParams {
  const zoom = 1 / (Math.abs(transform.scale.x) * pixelRatio);
  return {
    zoom,
    x: (canvasWidth / 2 - transform.position.x * pixelRatio) * zoom,
    y: (transform.position.y * pixelRatio - canvasHeight / 2) * zoom,
  };
}

/**
 * 战斗视口导出相机：布局中心（画布正中）为相机中心。
 * 导出画布的 backing 即逻辑像素（无独立 CSS 尺寸），pixelRatio 恒为 1。
 */
export function computeSpineBattleExportCamera(
  layout: BattleViewportLayout,
): SpineCameraParams {
  return computeSpineFixedCamera(
    {
      position: { x: layout.originX, y: layout.originY },
      scale: { x: layout.pixelsPerUnitX, y: layout.pixelsPerUnitY },
    },
    layout.width,
    layout.height,
  );
}
