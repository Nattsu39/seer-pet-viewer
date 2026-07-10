import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { planAtlasTileGrid, sliceQuadAcrossTiles, atlasBitmapPxToMeshUv, splitAtlasBitmap, insetTileSliceQuadUvs } from "./atlas-tile.js";
import { atlasPixelsToBitmap } from "./atlas.js";
import { parseBundleCore } from "./parse.js";

const bundlePath = resolve(import.meta.dirname, "../../../ppets_4911.bundle");

function sampleLikeShader(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  meshU: number,
  meshV: number,
): [number, number, number, number] {
  if (meshU < 0 || meshU > 1 || meshV < 0 || meshV > 1) return [0, 0, 0, 0];
  const x = meshU * (w - 1);
  const y = meshV * (h - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, w - 1);
  const y1 = Math.min(y0 + 1, h - 1);
  const tx = x - x0;
  const ty = y - y0;
  const sample = (sx: number, sy: number) => {
    const i = (sy * w + sx) * 4;
    return [
      rgba[i]!,
      rgba[i + 1]!,
      rgba[i + 2]!,
      rgba[i + 3]!,
    ] as [number, number, number, number];
  };
  const c00 = sample(x0, y0);
  const c10 = sample(x1, y0);
  const c01 = sample(x0, y1);
  const c11 = sample(x1, y1);
  const lerp = (a: number, b: number, t: number) => a * (1 - t) + b * t;
  const c0 = c00.map((c, i) => lerp(c, c10[i]!, tx)) as [number, number, number, number];
  const c1 = c01.map((c, i) => lerp(c, c11[i]!, tx)) as [number, number, number, number];
  return c0.map((c, i) => lerp(c, c1[i]!, ty)) as [number, number, number, number];
}

function maxChannelDelta(a: number[], b: number[]): number {
  return Math.max(...a.map((v, i) => Math.abs(v - b[i]!)));
}

function extractTileRgba(
  rgba: Uint8ClampedArray,
  atlasW: number,
  tile: { x: number; y: number; width: number; height: number },
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(tile.width * tile.height * 4);
  for (let y = 0; y < tile.height; y++) {
    for (let x = 0; x < tile.width; x++) {
      const src = ((tile.y + y) * atlasW + (tile.x + x)) * 4;
      const dst = (y * tile.width + x) * 4;
      out[dst] = rgba[src]!;
      out[dst + 1] = rgba[src + 1]!;
      out[dst + 2] = rgba[src + 2]!;
      out[dst + 3] = rgba[src + 3]!;
    }
  }
  return out;
}

function tileLocalUvToMeshUv(
  localU: number,
  localV: number,
  tile: { x: number; y: number; width: number; height: number },
  logicalW: number,
  logicalH: number,
): { u: number; v: number } {
  const tileWScale = Math.max(1, tile.width - 1);
  const tileHScale = Math.max(1, tile.height - 1);
  const px = localU * tileWScale + tile.x;
  const row = localV * tileHScale + tile.y;
  return atlasBitmapPxToMeshUv(px, row, logicalW, logicalH);
}

describe("ppets_4911 tile UV parity", () => {
  it("matches interior samples on cross-tile quads", async () => {
    const buf = readFileSync(bundlePath);
    const core = await parseBundleCore(buf, "ppets_4911");
    const plan = planAtlasTileGrid(core.atlasWidth, core.atlasHeight, 4096)!;
    const rgba = core.atlasPixels.rgba;
    const w = core.atlasWidth;
    const h = core.atlasHeight;
    const prepared = await atlasPixelsToBitmap(core.atlasPixels);
    const tileBitmaps = await splitAtlasBitmap(prepared.bitmap, plan);
    const tiles = await Promise.all(
      plan.tiles.map(async (tile, i) => ({
        tile,
        rgba: await rgbaFromBitmap(tileBitmaps[i]!),
      })),
    );

    const frame = core.sequences.find((s) => s.name === "attack")!.frames[0]!;
    let compared = 0;
    let mismatches = 0;
    let maxDelta = 0;

    function compareSample(
      fullU: number,
      fullV: number,
      tileRgba: Uint8ClampedArray,
      tile: { width: number; height: number; x: number; y: number },
      localU: number,
      localV: number,
    ) {
      const full = sampleLikeShader(rgba, w, h, fullU, fullV);
      const tiled = sampleLikeShader(tileRgba, tile.width, tile.height, localU, localV);
      const delta = maxChannelDelta(full, tiled);
      compared++;
      if (delta > 1) mismatches++;
      maxDelta = Math.max(maxDelta, delta);
    }

    for (const subMesh of frame.mesh.subMeshes) {
      const start = subMesh.startVertex;
      const vertCount = (subMesh.indexCount / 6) * 4;
      const positions: number[] = [];
      const uvs: number[] = [];
      const mulColors: number[] = [];
      const addColors: number[] = [];
      for (let vi = start; vi < start + vertCount; vi++) {
        positions.push(
          frame.mesh.positions[vi * 2]!,
          frame.mesh.positions[vi * 2 + 1]!,
        );
        uvs.push(frame.mesh.uvs[vi * 2]!, frame.mesh.uvs[vi * 2 + 1]!);
        mulColors.push(
          frame.mesh.mulColors[vi * 4]!,
          frame.mesh.mulColors[vi * 4 + 1]!,
          frame.mesh.mulColors[vi * 4 + 2]!,
          frame.mesh.mulColors[vi * 4 + 3]!,
        );
        addColors.push(
          frame.mesh.addColors[vi * 4]!,
          frame.mesh.addColors[vi * 4 + 1]!,
          frame.mesh.addColors[vi * 4 + 2]!,
          frame.mesh.addColors[vi * 4 + 3]!,
        );
      }

      const quadCount = vertCount / 4;

      for (let q = 0; q < quadCount; q++) {
        const slices = sliceQuadAcrossTiles(
          positions,
          uvs,
          q * 8,
          w,
          h,
          plan,
          mulColors,
          addColors,
          q * 4,
        );
        for (const slice of slices) {
          const tileEntry = tiles[slice.tileIndex]!;
          const sliceUvs = [...slice.uvs];
          insetTileSliceQuadUvs(
            sliceUvs,
            0,
            tileEntry.tile,
            w,
            h,
            slice.clipPxMin,
            slice.clipPxMax,
            slice.clipPyMin,
            slice.clipPyMax,
          );
          for (let corner = 0; corner < 4; corner++) {
            const localU = sliceUvs[corner * 2]!;
            const localV = sliceUvs[corner * 2 + 1]!;
            const { u: fullU, v: fullV } = tileLocalUvToMeshUv(
              localU,
              localV,
              tileEntry.tile,
              w,
              h,
            );
            const full = sampleLikeShader(rgba, w, h, fullU, fullV);
            const tiled = sampleLikeShader(
              tileEntry.rgba,
              tileEntry.tile.width,
              tileEntry.tile.height,
              localU,
              localV,
            );
            const delta = maxChannelDelta(full, tiled);
            compared++;
            if (delta > 1) mismatches++;
            maxDelta = Math.max(maxDelta, delta);
          }
        }
      }
    }

    expect(compared).toBeGreaterThan(0);
    expect(mismatches).toBe(0);
    expect(maxDelta).toBeLessThanOrEqual(1);
  }, 120_000);
});
