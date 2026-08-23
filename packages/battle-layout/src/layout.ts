export type BattleSide = "left" | "right";

/** 战斗布局设计稿：客户端 16:9 战斗界面的参考画布 */
export const BATTLE_DESIGN_WIDTH = 1920;
export const BATTLE_DESIGN_HEIGHT = 1080;

/** 客户端 BasePetAnimator.LEFT/RIGHT 的世界单位锚点偏移（取绝对值） */
export const BATTLE_ANCHOR_UNITS = 4;

/** 客户端 BattlePet*Animator 施加在宠物根节点的动画缩放 */
export const BATTLE_PET_ANIM_SCALE = 1.25;

/**
 * 默认单位像素比。
 */
export const DEFAULT_BATTLE_PX_PER_UNIT = 100;

/** 宠物容器（场景 Root/SWFPets）世界空间 y 偏移的默认值，场景数据回填前取 0 */
export const DEFAULT_BATTLE_CONTAINER_WORLD_Y = 0;

export interface BattleLayoutOptions {
  /** 单位像素比；省略时使用内置默认 */
  pxPerUnit?: number;
  /** 宠物容器在世界空间的 y 偏移（世界单位）；省略为 0 */
  containerWorldY?: number;
}

export interface BattlePetPlacement {
  side: BattleSide;
  /** 内容原点在设计稿画布上的像素位置（y 向下，屏幕约定） */
  position: { x: number; y: number };
  /** x 方向每内容单位的像素数；负值表示敌方镜像 */
  pixelsPerUnitX: number;
  /** y 方向每内容单位的像素数（正值；内容坐标 y 向上） */
  pixelsPerUnitY: number;
}

export interface ContentVertexBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function resolvePxPerUnit(pxPerUnit: number | undefined): number {
  const value = pxPerUnit ?? DEFAULT_BATTLE_PX_PER_UNIT;
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`pxPerUnit 必须为正数，收到 ${pxPerUnit}`);
  }
  return value;
}

/**
 * 计算一侧精灵的战斗布局。内容空间约定 y 向上、原点为精灵局部原点
 * （客户端 SetLocalXY 的 ±4 锚点即挂在原点上）。
 */
export function computeBattlePetPlacement(
  side: BattleSide,
  options: BattleLayoutOptions = {},
): BattlePetPlacement {
  const pxPerUnit = resolvePxPerUnit(options.pxPerUnit);
  const containerWorldY =
    options.containerWorldY ?? DEFAULT_BATTLE_CONTAINER_WORLD_Y;
  const anchorX = side === "left" ? -BATTLE_ANCHOR_UNITS : BATTLE_ANCHOR_UNITS;
  const mirror = side === "right" ? -1 : 1;
  return {
    side,
    position: {
      x: BATTLE_DESIGN_WIDTH / 2 + anchorX * pxPerUnit,
      y: BATTLE_DESIGN_HEIGHT / 2 - containerWorldY * pxPerUnit,
    },
    pixelsPerUnitX: mirror * BATTLE_PET_ANIM_SCALE * pxPerUnit,
    pixelsPerUnitY: BATTLE_PET_ANIM_SCALE * pxPerUnit,
  };
}

export interface BattleCanvasFit {
  /** 设计稿到目标画布的等比缩放（目标画布像素 / 设计稿像素） */
  scale: number;
  /** 设计稿原点在目标画布上的偏移（居中 letterbox） */
  offsetX: number;
  offsetY: number;
}

/** 将 1920×1080 设计稿等比适配到任意尺寸画布（居中，不拉伸） */
export function fitBattleCanvas(
  canvasWidth: number,
  canvasHeight: number,
): BattleCanvasFit {
  if (!(canvasWidth > 0) || !(canvasHeight > 0)) {
    return { scale: 0, offsetX: 0, offsetY: 0 };
  }
  const scale = Math.min(
    canvasWidth / BATTLE_DESIGN_WIDTH,
    canvasHeight / BATTLE_DESIGN_HEIGHT,
  );
  return {
    scale,
    offsetX: (canvasWidth - BATTLE_DESIGN_WIDTH * scale) / 2,
    offsetY: (canvasHeight - BATTLE_DESIGN_HEIGHT * scale) / 2,
  };
}

/** 把设计稿布局换算到任意尺寸画布的坐标 */
export function projectBattlePlacement(
  placement: BattlePetPlacement,
  fit: BattleCanvasFit,
): BattlePetPlacement {
  return {
    side: placement.side,
    position: {
      x: fit.offsetX + placement.position.x * fit.scale,
      y: fit.offsetY + placement.position.y * fit.scale,
    },
    pixelsPerUnitX: placement.pixelsPerUnitX * fit.scale,
    pixelsPerUnitY: placement.pixelsPerUnitY * fit.scale,
  };
}

/**
 * 序列顶点包围盒（内容单位，y 向上）在指定布局下占据的设计稿像素范围（y 向下）。
 * 镜像（pixelsPerUnitX < 0）会自动交换左右端点。
 */
export function battleSpaceVertexBounds(
  placement: BattlePetPlacement,
  bounds: ContentVertexBounds,
): ContentVertexBounds {
  const x0 = placement.position.x + bounds.minX * placement.pixelsPerUnitX;
  const x1 = placement.position.x + bounds.maxX * placement.pixelsPerUnitX;
  const y0 = placement.position.y - bounds.minY * placement.pixelsPerUnitY;
  const y1 = placement.position.y - bounds.maxY * placement.pixelsPerUnitY;
  return {
    minX: Math.min(x0, x1),
    maxX: Math.max(x0, x1),
    minY: Math.min(y0, y1),
    maxY: Math.max(y0, y1),
  };
}
