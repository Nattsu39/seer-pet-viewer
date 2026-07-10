import { describe, expect, it } from "vitest";
import {
  assignQuadToTile,
  atlasBitmapPxToMeshUv,
  atlasMeshUvToTileLocalUv,
  atlasOuterEdgeInsetFlags,
  countCrossTileQuads,
  getQuadPixelBounds,
  insetTileSliceQuadUvs,
  planAtlasTileGrid,
  remapQuadUvsToTile,
  sliceQuadAcrossTiles,
} from "./atlas-tile.js";
import { boundsToQuadUvs, insetQuadUvsSelective } from "./mesh.js";

describe("planAtlasTileGrid", () => {
  it("returns null when atlas fits within max tile size", () => {
    expect(planAtlasTileGrid(2048, 1024, 4096)).toBeNull();
  });

  it("plans 2x2 grid for 8192 square atlas with 4096 limit", () => {
    const plan = planAtlasTileGrid(8192, 8192, 4096)!;
    expect(plan.cols).toBe(2);
    expect(plan.rows).toBe(2);
    expect(plan.tiles).toHaveLength(4);
    expect(plan.tiles[0]).toMatchObject({
      col: 0,
      row: 0,
      x: 0,
      y: 0,
      width: 4096,
      height: 4096,
    });
    expect(plan.tiles[1]).toMatchObject({
      col: 1,
      row: 0,
      x: 4095,
      y: 0,
      width: 4096,
      height: 4096,
    });
    expect(plan.tiles[3]).toMatchObject({
      col: 1,
      row: 1,
      x: 4095,
      y: 4095,
      width: 4096,
      height: 4096,
    });
  });

  it("handles partial edge tiles", () => {
    const plan = planAtlasTileGrid(6144, 2048, 4096)!;
    expect(plan.cols).toBe(2);
    expect(plan.rows).toBe(1);
    expect(plan.tiles[1]).toMatchObject({ x: 4095, width: 2049, height: 2048 });
  });
});

describe("quad tile mapping", () => {
  const plan = planAtlasTileGrid(8192, 8192, 4096)!;

  it("remaps tile-local UV at tile center", () => {
    const w = 8192;
    const h = 8192;
    const tile = plan.tiles[3]!;
    const centerPx = tile.x + (tile.width - 1) / 2;
    const centerRow = tile.y + (tile.height - 1) / 2;
    const { u, v } = atlasBitmapPxToMeshUv(centerPx, centerRow, w, h);
    const uvs = [u, v, u, v, u, v, u, v];
    remapQuadUvsToTile(uvs, 0, tile, w, h);
    const direct = atlasMeshUvToTileLocalUv(u, v, tile, w, h);
    expect(uvs[0]).toBeCloseTo(direct.localU, 6);
    expect(uvs[1]).toBeCloseTo(direct.localV, 6);
    expect(uvs[0]).toBeCloseTo(0.5, 3);
    expect(uvs[1]).toBeCloseTo(0.5, 3);
  });

  it("maps mesh V to shader row order (v=0 top, v=1 bottom)", () => {
    const w = 8192;
    const h = 8192;
    const topLeft = boundsToQuadUvs(0.1, 0.1, 0.2, 0.2, w, h);
    const bounds = getQuadPixelBounds(topLeft.flat(), 0, w, h);
    expect(bounds.pyMin).toBeLessThan(bounds.pyMax);
    expect(bounds.pxMin).toBeLessThan(bounds.pxMax);
  });

  it("assigns quad fully inside one tile by AABB", () => {
    const quad = boundsToQuadUvs(0.1, 0.8, 0.2, 0.9, 8192, 8192);
    const bounds = getQuadPixelBounds(quad.flat(), 0, 8192, 8192);
    expect(assignQuadToTile(bounds.pxMin, bounds.pyMin, bounds.pxMax, bounds.pyMax, plan)).toBe(0);
  });

  it("counts zero cross-tile quads for a single-tile quad", () => {
    const uvs = [0.1, 0.1, 0.2, 0.1, 0.2, 0.2, 0.1, 0.2];
    const stats = countCrossTileQuads(uvs, 8192, 8192, plan);
    expect(stats.totalQuads).toBe(1);
    expect(stats.crossTileQuads).toBe(0);
  });

  it("splits a quad spanning the horizontal tile boundary", () => {
    const w = 8192;
    const h = 8192;
    const quad = boundsToQuadUvs(
      4000 / (w - 1),
      0.85,
      4200 / (w - 1),
      0.95,
      w,
      h,
    );
    const uvs = quad.flat();
    const positions = [0, 0, 100, 0, 100, 100, 0, 100];
    const slices = sliceQuadAcrossTiles(positions, uvs, 0, w, h, plan);
    expect(slices).toHaveLength(2);
    expect(slices.map((s) => s.tileIndex).sort()).toEqual([0, 1]);
  });

  it("covers the full quad px range without gaps at tile seams", () => {
    const w = 8192;
    const h = 8192;
    const quad = boundsToQuadUvs(
      4090 / (w - 1),
      0.85,
      4100 / (w - 1),
      0.95,
      w,
      h,
    );
    const bounds = getQuadPixelBounds(quad.flat(), 0, w, h);
    const slices = sliceQuadAcrossTiles(
      [0, 0, 100, 0, 100, 100, 0, 100],
      quad.flat(),
      0,
      w,
      h,
      plan,
    );
    expect(slices).toHaveLength(2);

    const covered: Array<[number, number]> = [];
    for (const slice of slices) {
      covered.push([slice.clipPxMin, slice.clipPxMax]);
    }
    covered.sort((a, b) => a[0]! - b[0]!);
    expect(covered[0]![0]).toBeCloseTo(bounds.pxMin, 3);
    expect(covered[covered.length - 1]![1]).toBeCloseTo(bounds.pxMax, 3);
    expect(covered[0]![1]).toBeCloseTo(4095, 3);
    expect(covered[1]![0]).toBeCloseTo(4095, 3);
  });

  it("expands slice geometry at internal tile seams", () => {
    const w = 8192;
    const h = 8192;
    const quad = boundsToQuadUvs(
      4090 / (w - 1),
      0.85,
      4100 / (w - 1),
      0.95,
      w,
      h,
    );
    const bounds = getQuadPixelBounds(quad.flat(), 0, w, h);
    const positions = [0, 0, 100, 0, 100, 100, 0, 100];
    const slices = sliceQuadAcrossTiles(positions, quad.flat(), 0, w, h, plan);
    const left = slices.find((s) => s.tileIndex === 0)!;
    const right = slices.find((s) => s.tileIndex === 1)!;
    const pxSpan = bounds.pxMax - bounds.pxMin;
    const leftTu1 = (left.clipPxMax - bounds.pxMin) / pxSpan;
    const rightTu0 = (right.clipPxMin - bounds.pxMin) / pxSpan;
    const leftGeomTu1 =
      (left.positions[2]! - left.positions[0]!) / (positions[2]! - positions[0]!);
    const rightGeomTu0 =
      (right.positions[0]! - positions[0]!) / (positions[2]! - positions[0]!);
    expect(leftGeomTu1).toBeGreaterThan(leftTu1);
    expect(rightGeomTu0).toBeLessThan(rightTu0);
  });

  it("keeps screen position aligned with UV rows on vertical tile splits", () => {
    const w = 8192;
    const h = 8192;
    const quad = boundsToQuadUvs(0.45, 0.45, 0.55, 0.55, w, h);
    const uvs = quad.flat();
    const positions = [10, 10, 90, 10, 90, 90, 10, 90];
    const slices = sliceQuadAcrossTiles(positions, uvs, 0, w, h, plan);
    expect(slices.length).toBeGreaterThanOrEqual(2);

    for (const slice of slices) {
      // UV 顶（localV 较小）应落在 screen y 较大处（顶点 2/3 侧）
      expect(slice.uvs[1]).toBeLessThan(slice.uvs[5]);
      expect(slice.positions[1]).toBeGreaterThan(slice.positions[5]);
      expect(slice.positions[3]).toBeGreaterThan(slice.positions[7]);
    }
  });

  it("does not inset internal vertical tile seam edges", () => {
    const w = 8192;
    const h = 8192;
    const leftTile = plan.tiles[0]!;
    const rightTile = plan.tiles[1]!;
    const quad = boundsToQuadUvs(
      4000 / (w - 1),
      0.85,
      4200 / (w - 1),
      0.95,
      w,
      h,
    );
    const uvs = quad.flat();
    const positions = [0, 0, 100, 0, 100, 100, 0, 100];
    const slices = sliceQuadAcrossTiles(positions, uvs, 0, w, h, plan);
    const leftSlice = slices.find((s) => s.tileIndex === 0)!;
    const rightSlice = slices.find((s) => s.tileIndex === 1)!;

    expect(
      atlasOuterEdgeInsetFlags(
        leftTile,
        w,
        h,
        leftSlice.clipPxMin,
        leftSlice.clipPxMax,
        leftSlice.clipPyMin,
        leftSlice.clipPyMax,
      ).insetUMax,
    ).toBe(false);
    expect(
      atlasOuterEdgeInsetFlags(
        rightTile,
        w,
        h,
        rightSlice.clipPxMin,
        rightSlice.clipPxMax,
        rightSlice.clipPyMin,
        rightSlice.clipPyMax,
      ).insetUMin,
    ).toBe(false);

    const leftUvs = [...leftSlice.uvs];
    const rightUvs = [...rightSlice.uvs];
    insetTileSliceQuadUvs(
      leftUvs,
      0,
      leftTile,
      w,
      h,
      leftSlice.clipPxMin,
      leftSlice.clipPxMax,
      leftSlice.clipPyMin,
      leftSlice.clipPyMax,
    );
    insetTileSliceQuadUvs(
      rightUvs,
      0,
      rightTile,
      w,
      h,
      rightSlice.clipPxMin,
      rightSlice.clipPxMax,
      rightSlice.clipPyMin,
      rightSlice.clipPyMax,
    );

    expect(leftUvs[2]).toBeCloseTo(1, 5);
    expect(rightUvs[0]).toBeCloseTo(0, 5);
  });

  it("still insets outer atlas edges on corner tile slices", () => {
    const w = 8192;
    const h = 8192;
    const topLeftTile = plan.tiles[0]!;
    const flags = atlasOuterEdgeInsetFlags(topLeftTile, w, h, 0, 100, 0, 100);
    expect(flags.insetUMin).toBe(true);
    expect(flags.insetVMin).toBe(true);
    expect(flags.insetUMax).toBe(false);
    expect(flags.insetVMax).toBe(false);

    const uvs = [0, 0, 0.1, 0, 0.1, 0.1, 0, 0.1];
    insetQuadUvsSelective(uvs, 0, topLeftTile.width, topLeftTile.height, flags);
    expect(uvs[0]).toBeGreaterThan(0);
    expect(uvs[1]).toBeGreaterThan(0);
    expect(uvs[2]).toBeCloseTo(0.1, 5);
    expect(uvs[5]).toBeCloseTo(0.1, 5);
  });
});
