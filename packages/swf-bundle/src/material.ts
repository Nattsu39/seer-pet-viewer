import type { Material } from "@arkntools/unity-js";
import type { SwfBlendMode, SwfMaterialState, SwfShaderKind } from "./types.js";

const GRAB_MODES: SwfBlendMode[] = [
  "darken",
  "difference",
  "invert",
  "overlay",
  "hardlight",
];

export function shaderKindFromMaterialName(
  name: string,
  blendMode: SwfBlendMode,
): SwfShaderKind {
  const lower = name.toLowerCase();
  if (lower.includes("incrmask")) return "incrMask";
  if (lower.includes("decrmask")) return "decrMask";
  const masked = lower.includes("masked");
  const grab = GRAB_MODES.includes(blendMode);
  if (masked && grab) return "maskedGrab";
  if (masked) return "masked";
  if (grab) return "simpleGrab";
  return "simple";
}

export function createMaterialState(
  blendMode: SwfBlendMode = "normal",
  stencilId = 0,
  materialName = "",
): SwfMaterialState {
  const grab = GRAB_MODES.includes(blendMode);
  const shaderKind = shaderKindFromMaterialName(materialName, blendMode);
  const { srcBlend, dstBlend, blendOp } = blendParams(blendMode);
  return {
    blendMode,
    shaderKind,
    srcBlend,
    dstBlend,
    blendOp,
    stencilId,
    grabBlend: grab ? blendMode : undefined,
  };
}

function blendParams(blendMode: SwfBlendMode): {
  srcBlend: number;
  dstBlend: number;
  blendOp: number;
} {
  switch (blendMode) {
    case "multiply":
      return { srcBlend: 2, dstBlend: 10, blendOp: 0 };
    case "screen":
      return { srcBlend: 4, dstBlend: 1, blendOp: 0 };
    case "lighten":
      return { srcBlend: 1, dstBlend: 10, blendOp: 2 };
    case "add":
      return { srcBlend: 1, dstBlend: 1, blendOp: 0 };
    case "subtract":
      return { srcBlend: 1, dstBlend: 1, blendOp: 2 };
    case "darken":
    case "difference":
    case "invert":
    case "overlay":
    case "hardlight":
    case "normal":
    case "layer":
    default:
      return { srcBlend: 1, dstBlend: 10, blendOp: 0 };
  }
}

export function parseBlendModeFromName(name: string): SwfBlendMode | null {
  const lower = name.toLowerCase();
  const modes: SwfBlendMode[] = [
    "normal",
    "layer",
    "multiply",
    "screen",
    "lighten",
    "darken",
    "difference",
    "add",
    "subtract",
    "invert",
    "overlay",
    "hardlight",
  ];
  for (const mode of modes) {
    if (lower.includes(mode)) return mode;
  }
  return null;
}

export class MaterialResolver {
  private readonly byPathId = new Map<string, SwfMaterialState>();
  private warnings: string[] = [];

  addFromBundle(materials: Material[]): void {
    for (const mat of materials) {
      const tree = mat.getTypeTree() as Record<string, unknown>;
      const name = (tree.m_Name as string) || mat.name || "";
      const blendMode = parseBlendModeFromName(name) ?? "normal";
      const stencilId = (tree._StencilID as number) ?? 0;
      this.byPathId.set(
        String(mat.pathId),
        createMaterialState(blendMode, stencilId, name),
      );
    }
  }

  resolveMaterialRef(
    fileId: number,
    pathId: bigint,
    index: number,
  ): SwfMaterialState {
    const key = String(pathId);
    const resolved = this.byPathId.get(key);
    if (resolved) return resolved;
    if (fileId !== 0) {
      this.warnings.push(
        `材质引用外部文件 (fileId=${fileId}, pathId=${pathId})，子网格 ${index} 使用 Normal 混合`,
      );
    }
    return createMaterialState("normal");
  }

  drainWarnings(): string[] {
    const w = [...this.warnings];
    this.warnings = [];
    return w;
  }

  get size(): number {
    return this.byPathId.size;
  }

  snapshot(): Record<string, SwfMaterialState> {
    return Object.fromEntries(this.byPathId);
  }

  restore(snapshot: Record<string, SwfMaterialState>): void {
    this.byPathId.clear();
    for (const [pathId, state] of Object.entries(snapshot)) {
      this.byPathId.set(pathId, state);
    }
  }
}

/** 赛尔 PetAnimPackage 内 FlashTools 共享 SWF 材质 bundle 文件名 */
export const SHARED_SWF_MATERIAL_BUNDLE_NAME =
  "petanimpackage_share_assets_flashtools_resources_materials_generated.bundle";

export const NORMAL_MATERIAL = createMaterialState("normal");
