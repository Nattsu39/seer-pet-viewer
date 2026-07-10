import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  areTileLocalUvsInRange,
  countCrossTileQuads,
  planAtlasTileGrid,
  sliceQuadAcrossTiles,
} from "./atlas-tile.js";
import { insetQuadUvs } from "./mesh.js";
import { parseBundleCore } from "./parse.js";

const bundlePath = resolve(import.meta.dirname, "../../../ppets_4911.bundle");

describe("ppets_4911 cross-tile quads", () => {
  it("reports cross-tile quad ratio when atlas is tiled at 4096", async () => {
    const buf = readFileSync(bundlePath);
    const core = await parseBundleCore(buf, "ppets_4911");
    const plan = planAtlasTileGrid(
      core.atlasWidth,
      core.atlasHeight,
      4096,
    );
    expect(plan).not.toBeNull();
    if (!plan) return;

    let totalQuads = 0;
    let crossTileQuads = 0;
    for (const seq of core.sequences) {
      for (const frame of seq.frames) {
        const stats = countCrossTileQuads(
          frame.mesh.uvs,
          core.atlasWidth,
          core.atlasHeight,
          plan,
        );
        totalQuads += stats.totalQuads;
        crossTileQuads += stats.crossTileQuads;
      }
    }

    const ratio = totalQuads > 0 ? crossTileQuads / totalQuads : 0;
    expect(totalQuads).toBeGreaterThan(0);
    expect(ratio).toBeLessThan(0.05);
  }, 60_000);

  it("keeps tile-local UVs in range after slicing at 4096", async () => {
    const buf = readFileSync(bundlePath);
    const core = await parseBundleCore(buf, "ppets_4911");
    const plan = planAtlasTileGrid(
      core.atlasWidth,
      core.atlasHeight,
      4096,
    )!;

    let totalSlices = 0;
    let outOfRangeSlices = 0;
    let emptySliceQuads = 0;
    let totalQuads = 0;

    for (const seq of core.sequences) {
      for (const frame of seq.frames) {
        for (const subMesh of frame.mesh.subMeshes) {
          const start = subMesh.startVertex;
          const vertCount = (subMesh.indexCount / 6) * 4;
          const uvs: number[] = [];
          const positions: number[] = [];
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
            totalQuads++;
            const slices = sliceQuadAcrossTiles(
              positions,
              uvs,
              q * 8,
              core.atlasWidth,
              core.atlasHeight,
              plan,
              mulColors,
              addColors,
              q * 4,
            );
            if (slices.length === 0) {
              emptySliceQuads++;
              continue;
            }
            for (const slice of slices) {
              totalSlices++;
              if (!areTileLocalUvsInRange(slice.uvs)) {
                outOfRangeSlices++;
              }
            }
          }
        }
      }
    }

    expect(emptySliceQuads).toBe(0);
    expect(outOfRangeSlices).toBe(0);
    expect(totalSlices).toBeGreaterThan(0);
  }, 120_000);
});
