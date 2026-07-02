import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseBundleCore } from "./parse.js";

const bundlePath = resolve(import.meta.dirname, "../../../ppets_4911.bundle");

describe("ppets_4911 moves_38419", () => {
  it("parses moves_38419 with valid mesh data", async () => {
    const buf = readFileSync(bundlePath);
    const core = await parseBundleCore(buf, "ppets_4911");
    const seq = core.sequences.find((s) => s.name === "moves_38419");
    expect(seq, "moves_38419 sequence").toBeTruthy();
    expect(seq!.frames.length).toBeGreaterThan(0);

    for (let i = 0; i < seq!.frames.length; i++) {
      const f = seq!.frames[i]!;
      const pos = f.mesh.positions;
      expect(pos.length, `frame ${i} positions`).toBeGreaterThanOrEqual(2);
      const vertCount = pos.length / 2;
      if (f.mesh.indices.length > 0) {
        const maxIdx = Math.max(...Array.from(f.mesh.indices));
        expect(maxIdx, `frame ${i} index OOB`).toBeLessThan(vertCount);
      }
      for (const sm of f.mesh.subMeshes) {
        expect(sm.indexCount % 6, `frame ${i} indexCount`).toBe(0);
        expect(sm.indexCount, `frame ${i} empty submesh`).toBeGreaterThan(0);
        const smVerts = (sm.indexCount / 6) * 4;
        expect(sm.startVertex + smVerts, `frame ${i} vertex range`).toBeLessThanOrEqual(
          vertCount,
        );
      }
    }

    const matKinds = new Set<string>();
    let grabSubMeshes = 0;
    let maskSubMeshes = 0;
    for (const f of seq!.frames) {
      for (const sm of f.mesh.subMeshes) {
        matKinds.add(sm.material.shaderKind);
        if (
          sm.material.shaderKind === "simpleGrab" ||
          sm.material.shaderKind === "maskedGrab"
        ) {
          grabSubMeshes++;
        }
        if (
          sm.material.shaderKind === "incrMask" ||
          sm.material.shaderKind === "decrMask" ||
          sm.material.shaderKind === "masked" ||
          sm.material.shaderKind === "maskedGrab"
        ) {
          maskSubMeshes++;
        }
      }
    }
    console.log(
      "moves_38419 shaderKinds",
      [...matKinds],
      "frames",
      seq!.frames.length,
      "grabSubMeshes",
      grabSubMeshes,
      "maskSubMeshes",
      maskSubMeshes,
    );

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const f of seq!.frames) {
      const pos = f.mesh.positions;
      for (let i = 0; i < pos.length; i += 2) {
        minX = Math.min(minX, pos[i]!);
        maxX = Math.max(maxX, pos[i]!);
        minY = Math.min(minY, pos[i + 1]!);
        maxY = Math.max(maxY, pos[i + 1]!);
      }
    }
    let emptyFrames = 0;
    for (const f of seq!.frames) {
      if (f.mesh.positions.length < 2 || f.mesh.subMeshes.length === 0) emptyFrames++;
    }
    console.log(`moves_38419 emptyFrames=${emptyFrames}`);
    expect(matKinds.size).toBeGreaterThan(0);
  });
});
