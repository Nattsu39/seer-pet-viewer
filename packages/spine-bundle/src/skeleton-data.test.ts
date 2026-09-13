import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AnimationState,
  AnimationStateData,
  AtlasAttachmentLoader,
  FakeTexture,
  Skeleton,
  SkeletonBinary,
  TextureAtlas,
  Vector2,
} from "@esotericsoftware/spine-core";
import { parseSpineBundleCore } from "./parse.js";

const spineBundle = resolve(
  import.meta.dirname,
  "../../../pskilltimeline_spines_4000",
);
// 夹具为本地游戏素材(不进 git),缺失时跳过,保证 CI 可跑
const hasSpineBundle = existsSync(spineBundle);

function bindAtlasTextures(atlas: TextureAtlas, core: Awaited<ReturnType<typeof parseSpineBundleCore>>) {
  const sizeByName = new Map(
    core.texturePixels.map((tex) => [tex.name, { width: tex.width, height: tex.height }]),
  );
  for (const page of atlas.pages) {
    const size = sizeByName.get(page.name);
    if (!size) {
      throw new Error(`缺少纹理页尺寸: ${page.name}`);
    }
    page.width = size.width;
    page.height = size.height;
    page.setTexture(new FakeTexture({ width: size.width, height: size.height }));
  }
}

describe.skipIf(!hasSpineBundle)("spine skeleton data", () => {
  it("loads attachments and has non-zero bounds", async () => {
    const buffer = readFileSync(spineBundle);
    const core = await parseSpineBundleCore(
      buffer,
      "pskilltimeline_spines_4000",
    );

    const atlas = new TextureAtlas(core.atlasText);
    bindAtlasTextures(atlas, core);

    const binary = new SkeletonBinary(new AtlasAttachmentLoader(atlas));
    binary.scale = core.scale;
    const skelData = binary.readSkeletonData(core.skeletonBytes);
    const skel = new Skeleton(skelData);
    skel.setToSetupPose();
    const state = new AnimationState(new AnimationStateData(skelData));
    state.setAnimation(0, "await", true);
    state.apply(skel);
    skel.updateWorldTransform();

    const attached = skel.slots.filter((slot) => slot.attachment).length;
    expect(attached).toBeGreaterThan(0);

    const offset = new Vector2();
    const size = new Vector2();
    skel.getBounds(offset, size);
    expect(size.x).toBeGreaterThan(0);
    expect(size.y).toBeGreaterThan(0);
  });

  it("decoded textures contain visible alpha", async () => {
    const buffer = readFileSync(spineBundle);
    const core = await parseSpineBundleCore(
      buffer,
      "pskilltimeline_spines_4000",
    );
    let maxAlpha = 0;
    for (const tex of core.texturePixels) {
      for (let i = 3; i < tex.rgba.length; i += 4) {
        maxAlpha = Math.max(maxAlpha, tex.rgba[i]);
      }
    }
    expect(maxAlpha).toBeGreaterThan(200);
  });
});
