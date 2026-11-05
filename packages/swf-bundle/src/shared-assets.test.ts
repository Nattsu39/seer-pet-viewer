import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseBundleCore } from "./parse.js";

// Official game assets are local-only fixtures.
const fixtures = resolve(
  import.meta.dirname,
  "../../../.cache/swf-shared-3291",
);
const main = resolve(fixtures, "ppets_3291.bundle");
const atlas = resolve(fixtures, "petanimpackage_share_assets_swf_3291.bundle");
const small = resolve(fixtures, "ppets_3291_small.bundle");

describe.skipIf(![main, atlas, small].every((path) => existsSync(path)))(
  "3291 shared SWF atlas",
  () => {
    it("resolves the external Sprite and decodes its atlas", async () => {
      const clip = await parseBundleCore(
        readFileSync(main),
        "ppets_3291",
        undefined,
        {
          sharedAssets: readFileSync(atlas),
        },
      );
      expect(clip.sequences.map((seq) => seq.name)).toContain("standby");
      expect([clip.atlasWidth, clip.atlasHeight]).toEqual([8192, 8192]);
      expect(clip.atlasPixels?.rgba.some((v, i) => i % 4 === 3 && v > 0)).toBe(
        true,
      );
    }, 30000);

    it("identifies a missing or mismatched external Sprite", async () => {
      await expect(parseBundleCore(readFileSync(main))).rejects.toThrow(
        "petanimpackage_share_assets_swf_3291.bundle",
      );
      await expect(
        parseBundleCore(readFileSync(main), "ppets_3291", undefined, {
          sharedAssets: readFileSync(small),
        }),
      ).rejects.toThrow("Sprite 不匹配");
    });

    it("uses the small variant's own atlas without a dependency", async () => {
      const clip = await parseBundleCore(
        readFileSync(small),
        "ppets_3291_small",
        undefined,
        { needAtlas: false },
      );
      expect([clip.atlasWidth, clip.atlasHeight]).toEqual([4096, 4096]);
      expect(clip.sequences.length).toBeGreaterThan(0);
    });
  },
);
