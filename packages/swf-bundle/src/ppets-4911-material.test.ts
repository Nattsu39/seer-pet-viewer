import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseBundleCore, loadMaterialBundle } from "./parse.js";
import { MaterialResolver } from "./material.js";

const bundlePath = resolve(import.meta.dirname, "../../../ppets_4911.bundle");
const materialsPath = resolve(import.meta.dirname, "../../../shared-materials.bundle");
// 夹具为本地游戏素材(不进 git),缺失时跳过,保证 CI 可跑
const hasFixture = existsSync(bundlePath) && existsSync(materialsPath);

describe.skipIf(!hasFixture)("ppets_4911 with shared materials", () => {
  it("moves_38419 materials differ when shared bundle loaded", async () => {
    const buf = readFileSync(bundlePath);
    const resolverPlain = new MaterialResolver();
    const plain = await parseBundleCore(buf, "ppets_4911", resolverPlain);

    const resolverMat = new MaterialResolver();
    const matBuf = readFileSync(materialsPath);
    await loadMaterialBundle(
      matBuf.buffer.slice(
        matBuf.byteOffset,
        matBuf.byteOffset + matBuf.byteLength,
      ),
      resolverMat,
    );
    const withMat = await parseBundleCore(buf, "ppets_4911", resolverMat);

    const seqPlain = plain.sequences.find((s) => s.name === "moves_38419")!;
    const seqMat = withMat.sequences.find((s) => s.name === "moves_38419")!;

    const kindsPlain = new Set<string>();
    const kindsMat = new Set<string>();
    for (const f of seqPlain.frames) {
      for (const sm of f.mesh.subMeshes) kindsPlain.add(sm.material.shaderKind);
    }
    for (const f of seqMat.frames) {
      for (const sm of f.mesh.subMeshes) kindsMat.add(sm.material.shaderKind);
    }

    expect(kindsPlain).toEqual(new Set(["simple"]));
    expect(kindsMat).toEqual(
      new Set(["simple", "incrMask", "masked", "decrMask", "simpleGrab"]),
    );
  }, 15_000);
});
