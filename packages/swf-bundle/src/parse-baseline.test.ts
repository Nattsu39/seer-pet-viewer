import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { parseBundleCore } from "./parse.js";
import { getMaxTextureSize } from "./max-texture-size.js";

const ROOT = resolve(import.meta.dirname, "../../..");
const BASELINE_DIR = resolve(ROOT, "examples/swf-baseline/parse");

const PARSE_TARGETS = [
  { id: "ppets_70", bundle: "ppets_70.bundle" },
  { id: "ppets_4911", bundle: "ppets_4911.bundle" },
] as const;

function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

describe("swf parse baseline", () => {
  for (const target of PARSE_TARGETS) {
    it(`writes parse stats for ${target.id}`, async () => {
      const bundlePath = resolve(ROOT, target.bundle);
      const buf = readFileSync(bundlePath);
      const core = await parseBundleCore(buf, target.id);
      const maxTextureSize = getMaxTextureSize();
      const needsTiling =
        core.atlasWidth > maxTextureSize || core.atlasHeight > maxTextureSize;

      const sequences = core.sequences.map((seq) => {
        const shaderKinds = new Set<string>();
        let grabSubMeshes = 0;
        let maskSubMeshes = 0;
        for (const frame of seq.frames) {
          for (const sm of frame.mesh.subMeshes) {
            shaderKinds.add(sm.material.shaderKind);
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
        return {
          name: seq.name,
          frameCount: seq.frames.length,
          shaderKinds: [...shaderKinds].sort(),
          grabSubMeshes,
          maskSubMeshes,
        };
      });

      const payload = {
        version: 1,
        targetId: target.id,
        bundle: target.bundle,
        atlasWidth: core.atlasWidth,
        atlasHeight: core.atlasHeight,
        frameRate: core.frameRate,
        petId: core.petId,
        materialWarnings: core.materialWarnings,
        maxTextureSize,
        needsTiling,
        sequences,
      };

      const outPath = resolve(BASELINE_DIR, `${target.id}.json`);
      writeJson(outPath, payload);

      expect(core.sequences.length).toBeGreaterThan(0);
      expect(payload.sequences.every((s) => s.frameCount > 0)).toBe(true);
    }, 120_000);
  }
});
