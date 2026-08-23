import {
  computeBattlePetPlacement,
  BATTLE_DESIGN_WIDTH,
  BATTLE_DESIGN_HEIGHT,
  type BattleLayoutOptions,
  type BattleSide,
} from "@seer/battle-layout";
import { fitCanvas, MAX_EXPORT_SIDE } from "./export-dimensions.js";

export interface BattleViewportOptions extends BattleLayoutOptions {
  side: BattleSide;
}

export interface BattleViewportLayout {
  width: number;
  height: number;
  /** 内容原点落在导出画布上的像素位置（y 向下） */
  originX: number;
  originY: number;
  /** 画布像素/内容单位（含用户倍率与 MAX_EXPORT_SIDE 钳制）；x 为负表示镜像 */
  pixelsPerUnitX: number;
  pixelsPerUnitY: number;
}

/**
 * 战斗视口导出布局：画布固定为 1920×1080 战斗设计帧（× 用户倍率），
 * 与内容包围盒无关——同一宠物所有序列同尺寸、同像素密度、锚点像素
 * 位置恒定，导出可与客户端截图（ModelImage，同为 1920×1080）逐帧比对；
 * 超出设计帧的内容按客户端行为裁掉。用户倍率使画布超过 MAX_EXPORT_SIDE
 * 时整帧等比钳制，钳制不随序列变化，不破坏可比性。
 */
export function planBattleViewportExport(
  options: BattleViewportOptions,
  userScale: number,
  maxSide = MAX_EXPORT_SIDE,
): BattleViewportLayout {
  const placement = computeBattlePetPlacement(options.side, options);
  const fitted = fitCanvas(
    BATTLE_DESIGN_WIDTH * userScale,
    BATTLE_DESIGN_HEIGHT * userScale,
    userScale,
    maxSide,
  );
  return {
    width: fitted.width,
    height: fitted.height,
    originX: placement.position.x * fitted.scale,
    originY: placement.position.y * fitted.scale,
    pixelsPerUnitX: placement.pixelsPerUnitX * fitted.scale,
    pixelsPerUnitY: placement.pixelsPerUnitY * fitted.scale,
  };
}
