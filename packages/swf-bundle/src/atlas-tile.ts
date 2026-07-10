import { insetQuadUvsSelective } from "./mesh.js";

export interface AtlasTileDesc {
  index: number;
  col: number;
  row: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AtlasTilePlan {
  logicalWidth: number;
  logicalHeight: number;
  maxTileSize: number;
  cols: number;
  rows: number;
  tiles: AtlasTileDesc[];
}

/** 相邻 tile 重叠像素数，供分块边缘双线性采样与切片无缝拼接 */
export const ATLAS_TILE_OVERLAP_PX = 1;

/** 软件双线性在 tile 边缘需要邻块像素；距边界在此范围内按跨块处理 */
export const ATLAS_TILE_BILINEAR_MARGIN_PX = 1;

export function atlasTileStride(
  maxTileSize: number,
  overlap = ATLAS_TILE_OVERLAP_PX,
): number {
  return maxTileSize - overlap;
}

function tilePxMax(tile: AtlasTileDesc): number {
  return tile.x + tile.width - 1;
}

function tilePyMax(tile: AtlasTileDesc): number {
  return tile.y + tile.height - 1;
}

function expandPixelBounds(
  pxMin: number,
  pyMin: number,
  pxMax: number,
  pyMax: number,
  marginPx: number,
): { pxMin: number; pyMin: number; pxMax: number; pyMax: number } {
  return {
    pxMin: pxMin - marginPx,
    pyMin: pyMin - marginPx,
    pxMax: pxMax + marginPx,
    pyMax: pyMax + marginPx,
  };
}

function tileContainsExpandedBounds(
  tile: AtlasTileDesc,
  pxMin: number,
  pyMin: number,
  pxMax: number,
  pyMax: number,
): boolean {
  return (
    pxMin >= tile.x &&
    pxMax <= tilePxMax(tile) &&
    pyMin >= tile.y &&
    pyMax <= tilePyMax(tile)
  );
}

function tilesIntersectingExpandedBounds(
  pxMin: number,
  pyMin: number,
  pxMax: number,
  pyMax: number,
  plan: AtlasTilePlan,
  marginPx = ATLAS_TILE_BILINEAR_MARGIN_PX,
): AtlasTileDesc[] {
  const expanded = expandPixelBounds(pxMin, pyMin, pxMax, pyMax, marginPx);
  return plan.tiles.filter(
    (tile) =>
      !(
        expanded.pxMax < tile.x ||
        expanded.pxMin > tilePxMax(tile) ||
        expanded.pyMax < tile.y ||
        expanded.pyMin > tilePyMax(tile)
      ),
  );
}

export function planAtlasTileGrid(
  width: number,
  height: number,
  maxTileSize: number,
): AtlasTilePlan | null {
  if (width <= maxTileSize && height <= maxTileSize) return null;

  const stride = atlasTileStride(maxTileSize);
  const cols = Math.ceil(width / maxTileSize);
  const rows = Math.ceil(height / maxTileSize);
  const tiles: AtlasTileDesc[] = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = col === 0 ? 0 : col * stride;
      const y = row === 0 ? 0 : row * stride;
      tiles.push({
        index: row * cols + col,
        col,
        row,
        x,
        y,
        width: Math.min(maxTileSize, width - x),
        height: Math.min(maxTileSize, height - y),
      });
    }
  }

  return {
    logicalWidth: width,
    logicalHeight: height,
    maxTileSize,
    cols,
    rows,
    tiles,
  };
}

export async function splitAtlasBitmap(
  bitmap: ImageBitmap,
  plan: AtlasTilePlan,
): Promise<ImageBitmap[]> {
  const out: ImageBitmap[] = [];
  for (const tile of plan.tiles) {
    out.push(
      await createImageBitmap(
        bitmap,
        tile.x,
        tile.y,
        tile.width,
        tile.height,
        { premultiplyAlpha: "none" },
      ),
    );
  }
  return out;
}

export function atlasMeshUToBitmapPx(
  meshU: number,
  meshV: number,
  logicalWidth: number,
  logicalHeight: number,
): { px: number; row: number } {
  const wScale = Math.max(1, logicalWidth - 1);
  const hScale = Math.max(1, logicalHeight - 1);
  // 与 swf-shader sampleSwfAtlas 一致：meshV=0 为图顶，meshV=1 为图底
  return {
    px: meshU * wScale,
    row: meshV * hScale,
  };
}

export function atlasBitmapPxToMeshUv(
  px: number,
  row: number,
  logicalWidth: number,
  logicalHeight: number,
): { u: number; v: number } {
  const wScale = Math.max(1, logicalWidth - 1);
  const hScale = Math.max(1, logicalHeight - 1);
  return {
    u: px / wScale,
    v: row / hScale,
  };
}

export function getQuadPixelBounds(
  uvs: ArrayLike<number>,
  quadOffset: number,
  logicalWidth: number,
  logicalHeight: number,
): { pxMin: number; pyMin: number; pxMax: number; pyMax: number } {
  let pxMin = Infinity;
  let pyMin = Infinity;
  let pxMax = -Infinity;
  let pyMax = -Infinity;

  for (let q = 0; q < 4; q++) {
    const { px, row } = atlasMeshUToBitmapPx(
      uvs[quadOffset + q * 2]!,
      uvs[quadOffset + q * 2 + 1]!,
      logicalWidth,
      logicalHeight,
    );
    pxMin = Math.min(pxMin, px);
    pyMin = Math.min(pyMin, row);
    pxMax = Math.max(pxMax, px);
    pyMax = Math.max(pyMax, row);
  }

  return { pxMin, pyMin, pxMax, pyMax };
}

export function isQuadCrossTile(
  pxMin: number,
  pyMin: number,
  pxMax: number,
  pyMax: number,
  plan: AtlasTilePlan,
  marginPx = ATLAS_TILE_BILINEAR_MARGIN_PX,
): boolean {
  const expanded = expandPixelBounds(pxMin, pyMin, pxMax, pyMax, marginPx);
  for (const tile of plan.tiles) {
    if (tileContainsExpandedBounds(tile, expanded.pxMin, expanded.pyMin, expanded.pxMax, expanded.pyMax)) {
      return false;
    }
  }
  return true;
}

export function assignQuadToTile(
  pxMin: number,
  pyMin: number,
  pxMax: number,
  pyMax: number,
  plan: AtlasTilePlan,
  marginPx = ATLAS_TILE_BILINEAR_MARGIN_PX,
): number {
  const expanded = expandPixelBounds(pxMin, pyMin, pxMax, pyMax, marginPx);
  for (const tile of plan.tiles) {
    if (tileContainsExpandedBounds(tile, expanded.pxMin, expanded.pyMin, expanded.pxMax, expanded.pyMax)) {
      return tile.index;
    }
  }

  const cx = (pxMin + pxMax) / 2;
  const cy = (pyMin + pyMax) / 2;
  const stride = atlasTileStride(plan.maxTileSize);
  const col = Math.min(plan.cols - 1, Math.max(0, Math.floor(cx / stride)));
  const row = Math.min(plan.rows - 1, Math.max(0, Math.floor(cy / stride)));
  return row * plan.cols + col;
}

export function atlasMeshUvToTileLocalUv(
  meshU: number,
  meshV: number,
  tile: AtlasTileDesc,
  logicalWidth: number,
  logicalHeight: number,
): { localU: number; localV: number } {
  const { px, row } = atlasMeshUToBitmapPx(
    meshU,
    meshV,
    logicalWidth,
    logicalHeight,
  );
  const tileWScale = Math.max(1, tile.width - 1);
  const tileHScale = Math.max(1, tile.height - 1);
  return {
    localU: (px - tile.x) / tileWScale,
    localV: (row - tile.y) / tileHScale,
  };
}

export function remapQuadUvsToTile(
  uvs: number[],
  quadOffset: number,
  tile: AtlasTileDesc,
  logicalWidth: number,
  logicalHeight: number,
): void {
  const tileWScale = Math.max(1, tile.width - 1);
  const tileHScale = Math.max(1, tile.height - 1);

  for (let q = 0; q < 4; q++) {
    const i = quadOffset + q * 2;
    const { px, row } = atlasMeshUToBitmapPx(
      uvs[i]!,
      uvs[i + 1]!,
      logicalWidth,
      logicalHeight,
    );
    uvs[i] = (px - tile.x) / tileWScale;
    uvs[i + 1] = (row - tile.y) / tileHScale;
  }
}

export interface TileQuadSlice {
  tileIndex: number;
  positions: number[];
  uvs: number[];
  mulColors: number[];
  addColors: number[];
  clipPxMin: number;
  clipPxMax: number;
  clipPyMin: number;
  clipPyMax: number;
}

/** 仅对落在逻辑图集外缘的 slice 边做 half-texel inset，tile 内接缝与切片边不内缩 */
export function atlasOuterEdgeInsetFlags(
  tile: AtlasTileDesc,
  logicalWidth: number,
  logicalHeight: number,
  clipPxMin: number,
  clipPxMax: number,
  clipPyMin: number,
  clipPyMax: number,
): {
  insetUMin: boolean;
  insetUMax: boolean;
  insetVMin: boolean;
  insetVMax: boolean;
} {
  return {
    insetUMin: clipPxMin <= tile.x && tile.x === 0,
    insetUMax:
      clipPxMax >= tile.x + tile.width - 1 &&
      tile.x + tile.width >= logicalWidth,
    insetVMin: clipPyMin <= tile.y && tile.y === 0,
    insetVMax:
      clipPyMax >= tile.y + tile.height - 1 &&
      tile.y + tile.height >= logicalHeight,
  };
}

export function insetTileSliceQuadUvs(
  uvs: number[],
  vertexOffset: number,
  tile: AtlasTileDesc,
  logicalWidth: number,
  logicalHeight: number,
  clipPxMin: number,
  clipPxMax: number,
  clipPyMin: number,
  clipPyMax: number,
): void {
  insetQuadUvsSelective(
    uvs,
    vertexOffset,
    tile.width,
    tile.height,
    atlasOuterEdgeInsetFlags(
      tile,
      logicalWidth,
      logicalHeight,
      clipPxMin,
      clipPxMax,
      clipPyMin,
      clipPyMax,
    ),
  );
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function bilinearQuadChannel4(
  colors: ArrayLike<number>,
  vertBase: number,
  channel: 0 | 1 | 2 | 3,
  tu: number,
  tv: number,
): number {
  const c00 = colors[vertBase * 4 + channel]!;
  const c10 = colors[(vertBase + 1) * 4 + channel]!;
  const c11 = colors[(vertBase + 2) * 4 + channel]!;
  const c01 = colors[(vertBase + 3) * 4 + channel]!;
  const c0 = lerp(c00, c10, tu);
  const c1 = lerp(c01, c11, tu);
  return lerp(c0, c1, tv);
}

function bilinearQuadColor4(
  colors: ArrayLike<number>,
  vertBase: number,
  tu: number,
  tv: number,
): [number, number, number, number] {
  return [
    bilinearQuadChannel4(colors, vertBase, 0, tu, tv),
    bilinearQuadChannel4(colors, vertBase, 1, tu, tv),
    bilinearQuadChannel4(colors, vertBase, 2, tu, tv),
    bilinearQuadChannel4(colors, vertBase, 3, tu, tv),
  ];
}

function copyQuadColors(colors: ArrayLike<number>, vertBase: number): number[] {
  const out: number[] = [];
  for (let v = 0; v < 4; v++) {
    out.push(
      colors[(vertBase + v) * 4]!,
      colors[(vertBase + v) * 4 + 1]!,
      colors[(vertBase + v) * 4 + 2]!,
      colors[(vertBase + v) * 4 + 3]!,
    );
  }
  return out;
}

function expandSliceGeometryAtSeams(
  tile: AtlasTileDesc,
  plan: AtlasTilePlan,
  pxMin: number,
  pyMin: number,
  pxMax: number,
  pyMax: number,
  clipMinX: number,
  clipMaxX: number,
  clipMinY: number,
  clipMaxY: number,
): {
  geomMinX: number;
  geomMaxX: number;
  geomMinY: number;
  geomMaxY: number;
} {
  const seamPx = ATLAS_TILE_OVERLAP_PX;
  let geomMinX = clipMinX;
  let geomMaxX = clipMaxX;
  let geomMinY = clipMinY;
  let geomMaxY = clipMaxY;

  if (tile.col > 0 && clipMinX <= tile.x) {
    geomMinX = Math.max(pxMin, clipMinX - seamPx);
  }
  if (tile.col < plan.cols - 1 && clipMaxX >= tilePxMax(tile)) {
    geomMaxX = Math.min(pxMax, clipMaxX + seamPx);
  }
  if (tile.row > 0 && clipMinY <= tile.y) {
    geomMinY = Math.max(pyMin, clipMinY - seamPx);
  }
  if (tile.row < plan.rows - 1 && clipMaxY >= tilePyMax(tile)) {
    geomMaxY = Math.min(pyMax, clipMaxY + seamPx);
  }

  return { geomMinX, geomMaxX, geomMinY, geomMaxY };
}

function bilinearQuadPosition(
  positions: ArrayLike<number>,
  quadOffset: number,
  tu: number,
  tv: number,
): [number, number] {
  const x00 = positions[quadOffset]!;
  const y00 = positions[quadOffset + 1]!;
  const x10 = positions[quadOffset + 2]!;
  const y10 = positions[quadOffset + 3]!;
  const x11 = positions[quadOffset + 4]!;
  const y11 = positions[quadOffset + 5]!;
  const x01 = positions[quadOffset + 6]!;
  const y01 = positions[quadOffset + 7]!;
  const x0 = lerp(x00, x10, tu);
  const y0 = lerp(y00, y10, tu);
  const x1 = lerp(x01, x11, tu);
  const y1 = lerp(y01, y11, tu);
  return [lerp(x0, x1, tv), lerp(y0, y1, tv)];
}

/** 将单个 axis-aligned quad 按 tile 网格切成若干片（跨 tile 时） */
export function sliceQuadAcrossTiles(
  positions: ArrayLike<number>,
  uvs: ArrayLike<number>,
  quadOffset: number,
  logicalWidth: number,
  logicalHeight: number,
  plan: AtlasTilePlan,
  mulColors?: ArrayLike<number>,
  addColors?: ArrayLike<number>,
  vertBase?: number,
): TileQuadSlice[] {
  const bounds = getQuadPixelBounds(uvs, quadOffset, logicalWidth, logicalHeight);
  const { pxMin, pyMin, pxMax, pyMax } = bounds;
  const vBase = vertBase ?? quadOffset / 2;
  if (pxMax - pxMin < 1e-6 || pyMax - pyMin < 1e-6) {
    const tileIndex = assignQuadToTile(pxMin, pyMin, pxMax, pyMax, plan);
    const tile = plan.tiles[tileIndex]!;
    const localUvs = [
      uvs[quadOffset]!,
      uvs[quadOffset + 1]!,
      uvs[quadOffset + 2]!,
      uvs[quadOffset + 3]!,
      uvs[quadOffset + 4]!,
      uvs[quadOffset + 5]!,
      uvs[quadOffset + 6]!,
      uvs[quadOffset + 7]!,
    ];
    remapQuadUvsToTile(localUvs, 0, tile, logicalWidth, logicalHeight);
    return [
      {
        tileIndex,
        positions: [
          positions[quadOffset]!,
          positions[quadOffset + 1]!,
          positions[quadOffset + 2]!,
          positions[quadOffset + 3]!,
          positions[quadOffset + 4]!,
          positions[quadOffset + 5]!,
          positions[quadOffset + 6]!,
          positions[quadOffset + 7]!,
        ],
        uvs: localUvs,
        mulColors: mulColors ? copyQuadColors(mulColors, vBase) : [],
        addColors: addColors ? copyQuadColors(addColors, vBase) : [],
        clipPxMin: pxMin,
        clipPxMax: pxMax,
        clipPyMin: pyMin,
        clipPyMax: pyMax,
      },
    ];
  }

  const intersectingTiles = tilesIntersectingExpandedBounds(
    pxMin,
    pyMin,
    pxMax,
    pyMax,
    plan,
  ).sort((a, b) => a.index - b.index);

  const slices: TileQuadSlice[] = [];
  for (const tile of intersectingTiles) {
      const clipMinX = Math.max(pxMin, tile.x);
      const clipMaxX = Math.min(pxMax, tilePxMax(tile));
      const clipMinY = Math.max(pyMin, tile.y);
      const clipMaxY = Math.min(pyMax, tilePyMax(tile));
      if (clipMinX > clipMaxX || clipMinY > clipMaxY) continue;

      const { geomMinX, geomMaxX, geomMinY, geomMaxY } =
        expandSliceGeometryAtSeams(
          tile,
          plan,
          pxMin,
          pyMin,
          pxMax,
          pyMax,
          clipMinX,
          clipMaxX,
          clipMinY,
          clipMaxY,
        );

      const tu0 = (geomMinX - pxMin) / (pxMax - pxMin);
      const tu1 = (geomMaxX - pxMin) / (pxMax - pxMin);
      const tvRow0 = (geomMinY - pyMin) / (pyMax - pyMin);
      const tvRow1 = (geomMaxY - pyMin) / (pyMax - pyMin);
      // boundsToQuadUvs：顶点 0/1 在 meshV 高端（图底），3/2 在低端（图顶）；
      // bilinearQuadPosition 的 tv=0 对应顶点 0→1 边，故像素行坐标需翻转。
      const tv0 = 1 - tvRow0;
      const tv1 = 1 - tvRow1;

      const p00 = bilinearQuadPosition(positions, quadOffset, tu0, tv0);
      const p10 = bilinearQuadPosition(positions, quadOffset, tu1, tv0);
      const p11 = bilinearQuadPosition(positions, quadOffset, tu1, tv1);
      const p01 = bilinearQuadPosition(positions, quadOffset, tu0, tv1);

      // 几何在接缝外扩以消除栅格裂缝，但 UV 仍钳在 tile 有效像素内
      const uvMinX = geomMinX < clipMinX ? clipMinX : geomMinX;
      const uvMaxX = geomMaxX > clipMaxX ? clipMaxX : geomMaxX;
      const uvMinY = geomMinY < clipMinY ? clipMinY : geomMinY;
      const uvMaxY = geomMaxY > clipMaxY ? clipMaxY : geomMaxY;

      const cornerMeshUvs = [
        atlasBitmapPxToMeshUv(uvMinX, uvMinY, logicalWidth, logicalHeight),
        atlasBitmapPxToMeshUv(uvMaxX, uvMinY, logicalWidth, logicalHeight),
        atlasBitmapPxToMeshUv(uvMaxX, uvMaxY, logicalWidth, logicalHeight),
        atlasBitmapPxToMeshUv(uvMinX, uvMaxY, logicalWidth, logicalHeight),
      ];
      const sliceUvs = [
        cornerMeshUvs[0]!.u,
        cornerMeshUvs[0]!.v,
        cornerMeshUvs[1]!.u,
        cornerMeshUvs[1]!.v,
        cornerMeshUvs[2]!.u,
        cornerMeshUvs[2]!.v,
        cornerMeshUvs[3]!.u,
        cornerMeshUvs[3]!.v,
      ];
      remapQuadUvsToTile(sliceUvs, 0, tile, logicalWidth, logicalHeight);

      const mul: number[] = [];
      const add: number[] = [];
      if (mulColors && addColors) {
        for (const [tu, tv] of [
          [tu0, tv0],
          [tu1, tv0],
          [tu1, tv1],
          [tu0, tv1],
        ] as const) {
          mul.push(...bilinearQuadColor4(mulColors, vBase, tu, tv));
          add.push(...bilinearQuadColor4(addColors, vBase, tu, tv));
        }
      }

      slices.push({
        tileIndex: tile.index,
        positions: [
          p00[0], p00[1],
          p10[0], p10[1],
          p11[0], p11[1],
          p01[0], p01[1],
        ],
        uvs: sliceUvs,
        mulColors: mul,
        addColors: add,
        clipPxMin: clipMinX,
        clipPxMax: clipMaxX,
        clipPyMin: clipMinY,
        clipPyMax: clipMaxY,
      });
  }

  if (slices.length === 0) {
    const tileIndex = assignQuadToTile(pxMin, pyMin, pxMax, pyMax, plan);
    const tile = plan.tiles[tileIndex]!;
    const localUvs = [
      uvs[quadOffset]!,
      uvs[quadOffset + 1]!,
      uvs[quadOffset + 2]!,
      uvs[quadOffset + 3]!,
      uvs[quadOffset + 4]!,
      uvs[quadOffset + 5]!,
      uvs[quadOffset + 6]!,
      uvs[quadOffset + 7]!,
    ];
    remapQuadUvsToTile(localUvs, 0, tile, logicalWidth, logicalHeight);
    return [
      {
        tileIndex,
        positions: [
          positions[quadOffset]!,
          positions[quadOffset + 1]!,
          positions[quadOffset + 2]!,
          positions[quadOffset + 3]!,
          positions[quadOffset + 4]!,
          positions[quadOffset + 5]!,
          positions[quadOffset + 6]!,
          positions[quadOffset + 7]!,
        ],
        uvs: localUvs,
        mulColors: mulColors ? copyQuadColors(mulColors, vBase) : [],
        addColors: addColors ? copyQuadColors(addColors, vBase) : [],
        clipPxMin: pxMin,
        clipPxMax: pxMax,
        clipPyMin: pyMin,
        clipPyMax: pyMax,
      },
    ];
  }

  return slices;
}

export function areTileLocalUvsInRange(
  uvs: ArrayLike<number>,
  epsilon = 1e-3,
): boolean {
  for (let i = 0; i < uvs.length; i += 2) {
    const u = uvs[i]!;
    const v = uvs[i + 1]!;
    if (u < -epsilon || u > 1 + epsilon || v < -epsilon || v > 1 + epsilon) {
      return false;
    }
  }
  return true;
}

export interface CrossTileQuadStats {
  totalQuads: number;
  crossTileQuads: number;
}

export function countCrossTileQuads(
  uvs: ArrayLike<number>,
  logicalWidth: number,
  logicalHeight: number,
  plan: AtlasTilePlan,
): CrossTileQuadStats {
  const quadCount = uvs.length / 8;
  let crossTileQuads = 0;
  for (let q = 0; q < quadCount; q++) {
    const bounds = getQuadPixelBounds(uvs, q * 8, logicalWidth, logicalHeight);
    if (
      isQuadCrossTile(
        bounds.pxMin,
        bounds.pyMin,
        bounds.pxMax,
        bounds.pyMax,
        plan,
      )
    ) {
      crossTileQuads++;
    }
  }
  return { totalQuads: quadCount, crossTileQuads };
}
