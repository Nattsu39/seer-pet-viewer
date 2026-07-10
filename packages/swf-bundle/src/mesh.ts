import type { SwfMaterialState } from "./types.js";

/** 与参考实现 unity_mesh_anim_extractor_json.py 一致 */
const UV_DIVISOR = 65536;
const FCOLOR_PRECISION = 1 / 512;

export function unpackUV(pack: number): [number, number] {
  const u = ((pack >>> 16) & 0xffff) / UV_DIVISOR;
  const v = (pack & 0xffff) / UV_DIVISOR;
  return [u, v];
}

/** 两个 UV 包定义矩形区域，按顶点 0..3 映射为 WebGL 纹理坐标 */
export function boundsToQuadUvs(
  u1: number,
  v1: number,
  u2: number,
  v2: number,
  atlasWidth?: number,
  atlasHeight?: number,
): [number, number][] {
  let uMin = Math.min(u1, u2);
  let uMax = Math.max(u1, u2);
  let vMin = Math.min(v1, v2);
  let vMax = Math.max(v1, v2);

  if (atlasWidth && atlasHeight && atlasWidth > 2 && atlasHeight > 2) {
    const du = 0.5 / atlasWidth;
    const dv = 0.5 / atlasHeight;
    if (uMax - uMin > du * 2) {
      uMin += du;
      uMax -= du;
    }
    if (vMax - vMin > dv * 2) {
      vMin += dv;
      vMax -= dv;
    }
  }

  return [
    [uMin, 1 - vMin],
    [uMax, 1 - vMin],
    [uMax, 1 - vMax],
    [uMin, 1 - vMax],
  ];
}

export interface QuadUvInsetEdges {
  insetUMin: boolean;
  insetUMax: boolean;
  insetVMin: boolean;
  insetVMax: boolean;
}

/** 对已展开的 4 顶点 UV 做半 texel 内缩，避免线性过滤采到 padding */
export function insetQuadUvs(
  uvs: ArrayLike<number>,
  vertexOffset: number,
  atlasWidth: number,
  atlasHeight: number,
): void {
  insetQuadUvsSelective(uvs, vertexOffset, atlasWidth, atlasHeight, {
    insetUMin: true,
    insetUMax: true,
    insetVMin: true,
    insetVMax: true,
  });
}

/** 按边选择性内缩；未触及的边保持原 UV（用于 tile 切片仅在外缘 inset） */
export function insetQuadUvsSelective(
  uvs: ArrayLike<number>,
  vertexOffset: number,
  atlasWidth: number,
  atlasHeight: number,
  edges: QuadUvInsetEdges,
): void {
  if (atlasWidth <= 2 || atlasHeight <= 2) return;
  const du = 0.5 / atlasWidth;
  const dv = 0.5 / atlasHeight;

  let uMin = Infinity;
  let uMax = -Infinity;
  let vMin = Infinity;
  let vMax = -Infinity;
  for (let q = 0; q < 4; q++) {
    const u = uvs[vertexOffset + q * 2]!;
    const v = uvs[vertexOffset + q * 2 + 1]!;
    uMin = Math.min(uMin, u);
    uMax = Math.max(uMax, u);
    vMin = Math.min(vMin, v);
    vMax = Math.max(vMax, v);
  }

  const canInsetU = uMax - uMin > du * 2;
  const canInsetV = vMax - vMin > dv * 2;
  const effUMin =
    edges.insetUMin && canInsetU ? uMin + du : uMin;
  const effUMax =
    edges.insetUMax && canInsetU ? uMax - du : uMax;
  const effVMin =
    edges.insetVMin && canInsetV ? vMin + dv : vMin;
  const effVMax =
    edges.insetVMax && canInsetV ? vMax - dv : vMax;

  for (let q = 0; q < 4; q++) {
    const i = vertexOffset + q * 2;
    const u = uvs[i]!;
    const v = uvs[i + 1]!;
    (uvs as number[])[i] = Math.abs(u - uMin) < Math.abs(u - uMax) ? effUMin : effUMax;
    (uvs as number[])[i + 1] =
      Math.abs(v - vMin) < Math.abs(v - vMax) ? effVMin : effVMax;
  }
}

export function unpackFColorFromUInts(
  pack0: number,
  pack1: number,
): [number, number, number, number] {
  const toSigned = (v: number) => {
    const s = v & 0xffff;
    return s > 0x7fff ? s - 0x10000 : s;
  };
  return [
    toSigned(pack0 >>> 16) * FCOLOR_PRECISION,
    toSigned(pack0 & 0xffff) * FCOLOR_PRECISION,
    toSigned(pack1 >>> 16) * FCOLOR_PRECISION,
    toSigned(pack1 & 0xffff) * FCOLOR_PRECISION,
  ];
}

export interface RawMeshData {
  SubMeshes: Array<{ StartVertex: number; IndexCount: number }>;
  Vertices: Array<{ x: number; y: number }>;
  UVs: number[];
  AddColors: number[];
  MulColors: number[];
}

export function buildFrameMesh(
  meshData: RawMeshData,
  materials: SwfMaterialState[],
  materialPathIds?: string[],
): {
  positions: Float32Array;
  uvs: Float32Array;
  addColors: Float32Array;
  mulColors: Float32Array;
  indices: Uint16Array;
  subMeshes: Array<{
    startVertex: number;
    indexCount: number;
    indexStart: number;
    material: SwfMaterialState;
  }>;
} {
  const positions: number[] = [];
  const uvs: number[] = [];
  const addColors: number[] = [];
  const mulColors: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i < meshData.UVs.length; i += 2) {
    const [u1, v1] = unpackUV(meshData.UVs[i]!);
    const [u2, v2] = unpackUV(meshData.UVs[i + 1]!);
    const quadUvs = boundsToQuadUvs(u1, v1, u2, v2);
    const vi = i / 2;
    for (let q = 0; q < 4; q++) {
      const vert = meshData.Vertices[vi * 4 + q];
      positions.push(vert?.x ?? 0, vert?.y ?? 0);
      uvs.push(quadUvs[q]![0], quadUvs[q]![1]);
    }
    const addPack0 = meshData.AddColors[vi * 2] ?? 0;
    const addPack1 = meshData.AddColors[vi * 2 + 1] ?? 0;
    const mulPack0 = meshData.MulColors[vi * 2] ?? 0;
    const mulPack1 = meshData.MulColors[vi * 2 + 1] ?? 0;
    const add = unpackFColorFromUInts(addPack0, addPack1);
    const mul = unpackFColorFromUInts(mulPack0, mulPack1);
    for (let q = 0; q < 4; q++) {
      addColors.push(add[0], add[1], add[2], add[3]);
      mulColors.push(mul[0], mul[1], mul[2], mul[3]);
    }
  }

  const subMeshes = meshData.SubMeshes.map((sm, index) => {
    const indexStart = indices.length;
    let startVertex = sm.StartVertex;
    const indexCount = sm.IndexCount;
    for (let j = 0; j < indexCount; j += 6) {
      indices.push(
        startVertex + 2,
        startVertex + 1,
        startVertex + 0,
        startVertex + 0,
        startVertex + 3,
        startVertex + 2,
      );
      startVertex += 4;
    }
    return {
      startVertex: sm.StartVertex,
      indexCount,
      indexStart,
      material: materials[index] ?? materials[0]!,
      materialPathId: materialPathIds?.[index] ?? materialPathIds?.[0],
    };
  });

  return {
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    addColors: new Float32Array(addColors),
    mulColors: new Float32Array(mulColors),
    indices: new Uint16Array(indices),
    subMeshes,
  };
}
