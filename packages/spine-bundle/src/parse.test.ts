import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  detectBundleKind,
  parseSpineBundleCore,
  parseSpineBundleMetadata,
} from "./parse.js";
import { extractSpinePetId } from "./pet-id.js";

function readSpineVersion(bytes: Uint8Array): string {
  const head = bytes.subarray(0, 64);
  const match = new TextDecoder("ascii").decode(head).match(/4\.0\.\d+/);
  if (!match) {
    throw new Error("未在 skeleton 二进制中找到 Spine 版本号");
  }
  return match[0];
}

const spineBundle = resolve(
  import.meta.dirname,
  "../../../pskilltimeline_spines_4000",
);
// 夹具为本地游戏素材(不进 git),缺失时跳过,保证 CI 可跑
const hasSpineBundle = existsSync(spineBundle);

describe("spine-bundle", () => {
  it.skipIf(!hasSpineBundle)("detects spine bundle kind", async () => {
    const buffer = readFileSync(spineBundle);
    await expect(detectBundleKind(buffer)).resolves.toBe("spine");
  });

  it.skipIf(!hasSpineBundle)("parses pskilltimeline_spines_4000 metadata", async () => {
    const buffer = readFileSync(spineBundle);
    const meta = await parseSpineBundleMetadata(
      buffer,
      "pskilltimeline_spines_4000",
    );
    expect(meta.petId).toBe(4000);
    expect(meta.scale).toBeCloseTo(0.01, 5);
    expect(meta.defaultMix).toBeCloseTo(0.2, 5);
    expect(meta.animations.sort()).toEqual(
      ["appear", "attack", "await", "cp", "hidemove", "hited", "sa"].sort(),
    );
    expect(meta.skeletonBytes.byteLength).toBeGreaterThan(1000);
    expect(meta.atlasText).toContain("pma:true");
    expect(meta.atlasText).toContain("4000_7.png");
  });

  it.skipIf(!hasSpineBundle)("reads skeleton version from binary header", async () => {
    const buffer = readFileSync(spineBundle);
    const meta = await parseSpineBundleMetadata(
      buffer,
      "pskilltimeline_spines_4000",
    );
    expect(readSpineVersion(meta.skeletonBytes)).toBe("4.0.64");
    expect(meta.animations).toHaveLength(7);
    expect(meta.animations).toContain("await");
    expect(meta.animations).toContain("attack");
  });

  it("extracts pet id from spine bundle names", () => {
    expect(extractSpinePetId("pskilltimeline_spines_4000")).toBe(4000);
    expect(extractSpinePetId("bundle", "4000_SkeletonData")).toBe(4000);
  });

  it.skipIf(!hasSpineBundle)("parses full bundle when texture decode is available", async () => {
    const buffer = readFileSync(spineBundle);
    const core = await parseSpineBundleCore(
      buffer,
      "pskilltimeline_spines_4000",
    );
    expect(core.texturePixels).toHaveLength(7);
    for (const tex of core.texturePixels) {
      expect(tex.rgba.length).toBe(tex.width * tex.height * 4);
    }
  });
});
