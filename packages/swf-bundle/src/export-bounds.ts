import type { SwfSequence, SwfSubMesh } from "./types.js";

export interface VertexBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** 与 pet_export.py SWF_BASE_MAT_ID 对齐 */
export const SWF_BASE_MATERIAL_PATH_ID = "-8829651964785685189";

export interface SequenceVertexBoundsOptions {
  /** 仅统计普通混合层顶点（与 pet_export BOUNDS_EXCLUDE_ADD 一致） */
  excludeFxLayers?: boolean;
}

export function isSwfContentLayer(subMesh: SwfSubMesh): boolean {
  if (subMesh.materialPathId === SWF_BASE_MATERIAL_PATH_ID) return true;
  const mode = subMesh.material.blendMode;
  return mode === "normal" || mode === "layer";
}

const EMPTY_BOUNDS: VertexBounds = { minX: 0, minY: 0, maxX: 1, maxY: 1 };

function expandVertexRange(
  bounds: VertexBounds,
  positions: Float32Array,
  startVertex: number,
  vertCount: number,
): VertexBounds {
  let { minX, minY, maxX, maxY } = bounds;
  for (let vi = startVertex; vi < startVertex + vertCount; vi++) {
    const x = positions[vi * 2]!;
    const y = positions[vi * 2 + 1]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

export function computeSequenceVertexBounds(
  seq: SwfSequence,
  options: SequenceVertexBoundsOptions = {},
): VertexBounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const frame of seq.frames) {
    const pos = frame.mesh.positions;
    if (options.excludeFxLayers) {
      for (const sm of frame.mesh.subMeshes) {
        if (!isSwfContentLayer(sm)) continue;
        const vertCount = (sm.indexCount / 6) * 4;
        ({ minX, minY, maxX, maxY } = expandVertexRange(
          { minX, minY, maxX, maxY },
          pos,
          sm.startVertex,
          vertCount,
        ));
      }
    } else {
      for (let i = 0; i < pos.length; i += 2) {
        const x = pos[i]!;
        const y = pos[i + 1]!;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (!Number.isFinite(minX)) return EMPTY_BOUNDS;
  return { minX, minY, maxX, maxY };
}
