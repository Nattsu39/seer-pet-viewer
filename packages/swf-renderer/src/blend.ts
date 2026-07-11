import type { SwfBlendMode, SwfMaterialState } from "@seer/swf-bundle";

/** 与 pet_export.swf_shade_vec 一致：这些混合在 Unity 侧假定 PMA 片元色 */
const PMA_OUTPUT_BLEND_MODES: ReadonlySet<SwfBlendMode> = new Set([
  "screen",
  "lighten",
  "multiply",
]);

export function needsPmaShaderOutput(material: SwfMaterialState): boolean {
  return PMA_OUTPUT_BLEND_MODES.has(material.blendMode);
}

export type PixiBlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "add"
  | "subtract"
  | "overlay"
  | "darken"
  | "hard-light";

export interface PixiBlendState {
  blendMode: PixiBlendMode;
}

export function materialToPixiBlend(material: SwfMaterialState): PixiBlendState {
  switch (material.blendMode) {
    case "multiply":
      return { blendMode: "multiply" };
    case "screen":
      return { blendMode: "screen" };
    case "add":
      return { blendMode: "add" };
    case "lighten":
      return { blendMode: "screen" };
    case "subtract":
      return { blendMode: "subtract" };
    case "overlay":
      return { blendMode: "overlay" };
    case "darken":
      return { blendMode: "darken" };
    case "hardlight":
      return { blendMode: "hard-light" };
    default:
      return { blendMode: "normal" };
  }
}

export function needsGrabPass(material: SwfMaterialState): boolean {
  return (
    material.shaderKind === "simpleGrab" ||
    material.shaderKind === "maskedGrab"
  );
}

export function needsStencilTest(material: SwfMaterialState): boolean {
  return (
    material.shaderKind === "masked" || material.shaderKind === "maskedGrab"
  );
}

export function isMaskWriter(material: SwfMaterialState): boolean {
  return material.shaderKind === "incrMask";
}

export function isMaskClearer(material: SwfMaterialState): boolean {
  return material.shaderKind === "decrMask";
}
