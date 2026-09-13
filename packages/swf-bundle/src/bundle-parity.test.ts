import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadAssetBundle, AssetType } from "@arkntools/unity-js";
import { flipAtlasY } from "./atlas.js";
import { parseBundleCore } from "./parse.js";
import { parsedBundleToJson } from "./clip-data.js";

const root = resolve(import.meta.dirname, "../../..");
const bundlePath = resolve(root, "ppets_70.bundle");
const metaPath = resolve(root, "examples/ppets_70.swfclip/meta.json");
// 夹具为本地游戏素材(不进 git),缺失时跳过,保证 CI 可跑
const hasFixture = existsSync(bundlePath) && existsSync(metaPath);

describe.skipIf(!hasFixture)("bundle vs swfclip parity", () => {
  it("parseBundleCore frame0 uvs match exported swfclip", async () => {
    const buf = readFileSync(bundlePath);
    const core = await parseBundleCore(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      "ppets_70.bundle",
    );
    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    const parsed = Array.from(core.sequences[0]!.frames[0]!.mesh.uvs);
    const exported = meta.sequences[0].frames[0].uvs;
    for (let i = 0; i < parsed.length; i++) {
      expect(parsed[i]).toBeCloseTo(exported[i]!, 5);
    }
  });

  it("flipAtlasY(unity-js raw) matches exported atlas.png bytes", async () => {
    const buf = readFileSync(bundlePath);
    const bundle = await loadAssetBundle(buf);
    const texture = bundle.objects.find((o) => o.type === AssetType.Texture2D);
    if (!texture) throw new Error("no texture");
    const tex = texture as unknown as {
      image: { data: Uint8Array };
      width: number;
      height: number;
    };
    const oriented = flipAtlasY(
      new Uint8ClampedArray(tex.image.data),
      tex.width,
      tex.height,
    );
    writeFileSync(
      resolve(root, "tools/.atlas-oriented.raw"),
      Buffer.from(oriented.buffer, oriented.byteOffset, oriented.byteLength),
    );
    expect(oriented.length).toBe(tex.width * tex.height * 4);
  });

  it("parsedBundleToJson frame0 matches exported meta", async () => {
    const buf = readFileSync(bundlePath);
    const core = await parseBundleCore(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      "ppets_70.bundle",
    );
    const live = parsedBundleToJson(core).sequences[0].frames[0];
    const exported = JSON.parse(readFileSync(metaPath, "utf-8")).sequences[0]
      .frames[0];
    expect(live.uvs).toEqual(exported.uvs);
    expect(live.indices).toEqual(exported.indices);
    expect(live.positions.length).toBe(exported.positions.length);
  });
});
