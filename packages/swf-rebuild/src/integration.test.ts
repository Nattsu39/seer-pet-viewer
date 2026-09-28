import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readSwf, readTags } from "./swf.js";

// 真实资源保存在包目录之外。设置此目录后，可在构建包后运行从解码、编码到 CLI 的完整回归。
const fixtures = process.env.SWF_REBUILD_FIXTURES;
const execute = promisify(execFile);
interface Sample {
  id: string;
  sprites: number[][];
  retained: number[];
  bitmaps: number;
  hits: number[];
  abcGrowth: number;
  masks: number;
  outputSha256: string;
  nested?: { wrapper: number; sourceContent: number; frames: number };
}
const samples: Sample[] = [
  {
    id: "4944",
    sprites: [
      [144, 64],
      [146, 92],
      [148, 92],
      [150, 78],
      [151, 8],
      [152, 29],
    ],
    retained: [151, 152],
    bitmaps: 248,
    hits: [68, 58, 56],
    abcGrowth: 0,
    masks: 0,
    outputSha256:
      "ad5f635c182ca0f46fe5b1b2bb2fbce85417a041f13813a25a67b7e87452b0e5",
  },
  {
    id: "4995",
    sprites: [
      [166, 40],
      [168, 156],
      [170, 98],
      [172, 82],
      [173, 7],
      [174, 29],
    ],
    retained: [173, 174],
    bitmaps: 404,
    hits: [121, 70, 35],
    abcGrowth: 1,
    masks: 17,
    outputSha256:
      "7660b808c032ef18c76230ca1e71e37be3a99c8a5879d9889d25091cf81d0694",
  },
  {
    id: "4946",
    sprites: [
      [239, 120],
      [241, 140],
      [243, 112],
      [245, 86],
      [274, 3],
      [272, 8],
      [275, 37],
    ],
    retained: [272, 275],
    bitmaps: 727,
    hits: [100, 82, 58, 3],
    abcGrowth: 1,
    masks: 189,
    nested: { wrapper: 274, sourceContent: 273, frames: 40 },
    outputSha256:
      "8cccf26ae7c4d10c7bcea75563bfbbd711de63c21aff24591c38d6282555ec61",
  },
  {
    id: "4947",
    sprites: [
      [263, 128],
      [265, 184],
      [267, 116],
      [269, 92],
      [270, 8],
      [271, 29],
    ],
    retained: [270, 271],
    bitmaps: 405,
    hits: [139, 72, 62],
    abcGrowth: 2,
    masks: 112,
    outputSha256:
      "fd26a66218430c9caa4a76a1e95745bde94fda816d0f5b62df4112811df2153f",
  },
];
const scaledSample = {
  ...samples[3],
  textureScale: 0.5,
  outputSha256:
    "ca227c2a6edfa70d3f625ac06d71611e7636fb40d0db6d6081de32718557107f",
};
const cases = [
  ...samples.map((sample) => ({ ...sample, textureScale: 1 })),
  scaledSample,
  {
    ...samples[2],
    textureScale: 0.5,
    outputSha256:
      "adc98aba99f0fdd3c52cd4ab36cfb67f1b95b6d684563fd53ddbe0eff6182cfc",
  },
];
describe.skipIf(!fixtures)("real-resource regression", () => {
  it.each(cases)(
    "$id at scale $textureScale: preserves the reviewed Flash output",
    async (sample) => {
      const source = resolve(fixtures!, `${sample.id}.swf`);
      const temporaryRoot = realpathSync(tmpdir());
      const directory = mkdtempSync(join(temporaryRoot, "swf-rebuild-test-"));
      try {
        const output = join(directory, `${sample.id}.swf`);
        const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
        await execute(
          process.execPath,
          [
            cli,
            "--source",
            source,
            "--bundle",
            resolve(fixtures!, `ppets_${sample.id}.bundle`),
            "--materials",
            resolve(
              fixtures!,
              "petanimpackage_share_assets_flashtools_resources_materials_generated.bundle",
            ),
            "--out",
            output,
            "--previews",
            join(directory, "previews"),
            ...(sample.textureScale === 1
              ? []
              : ["--texture-scale", String(sample.textureScale)]),
          ],
          { timeout: 60000, encoding: "utf8" },
        );
        const before = readSwf(readFileSync(source));
        const after = readSwf(readFileSync(output));
        expect(after.header).toEqual(before.header);
        const originalSprites = new Map(
          before.tags
            .filter((tag) => tag.code === 39)
            .map((tag) => [tag.data.readUInt16LE(), tag]),
        );
        const sprites = new Map(
          after.tags
            .filter((tag) => tag.code === 39)
            .map((tag) => [tag.data.readUInt16LE(), tag]),
        );
        for (const [id, count] of sample.sprites) {
          const data = sprites.get(id)!.data;
          expect(data.readUInt16LE(2)).toBe(count);
          expect(
            readTags(data.subarray(4)).filter((tag) => tag.code === 1),
          ).toHaveLength(count);
        }
        for (const id of sample.retained)
          expect(sprites.get(id)).toEqual(originalSprites.get(id));
        if (sample.nested) {
          const wrapper = sprites.get(sample.nested.wrapper)!;
          const children = readTags(wrapper.data.subarray(4)).filter(
            (tag) => tag.code === 26,
          );
          const contentId = children[0].data.readUInt16LE(3);
          const content = sprites.get(contentId)!;
          expect(content.data.readUInt16LE(2)).toBe(sample.nested.frames);
          expect(
            readTags(content.data.subarray(4)).filter((tag) => tag.code === 1),
          ).toHaveLength(sample.nested.frames);
          expect(sprites.get(sample.nested.sourceContent)).toEqual(
            originalSprites.get(sample.nested.sourceContent),
          );
          const restored = Buffer.from(wrapper.data);
          restored.writeUInt16LE(
            sample.nested.sourceContent,
            wrapper.data.indexOf(children[0].data) + 3,
          );
          expect(restored).toEqual(
            originalSprites.get(sample.nested.wrapper)!.data,
          );
        }
        const unchangedCodes = [69, 76, 26, 86];
        expect(
          after.tags.filter((tag) => unchangedCodes.includes(tag.code)),
        ).toEqual(
          before.tags.filter((tag) => unchangedCodes.includes(tag.code)),
        );
        const originalAbc = before.tags.find((tag) => tag.code === 82)!.data;
        const rebuiltAbc = after.tags.find((tag) => tag.code === 82)!.data;
        expect(rebuiltAbc.length).toBe(originalAbc.length + sample.abcGrowth);
        if (sample.id === "4944") {
          expect(
            [...rebuiltAbc.keys()].filter(
              (i) => rebuiltAbc[i] !== originalAbc[i],
            ),
          ).toHaveLength(6);
        }
        const preview = readSwf(
          readFileSync(join(directory, "previews", `${sample.id}-attack.swf`)),
        );
        expect(preview.tags.filter((tag) => tag.code === 1)).toHaveLength(
          sample.sprites[1][1],
        );
        expect(
          preview.tags.some((tag) => [12, 59, 82].includes(tag.code)),
        ).toBe(false);
        const report = JSON.parse(readFileSync(`${output}.json`, "utf8"));
        // 固定已检查的输出结果，包括修复后的嵌套出场结构约定。
        expect(report.outputSha256).toBe(sample.outputSha256);
        expect(report.bitmapCount).toBe(sample.bitmaps);
        expect(report.textureScale).toBe(sample.textureScale);
        if (sample.textureScale === 0.5) {
          expect(report.originalBitmapPixelBytes).toBe(
            sample.nested ? 182633288 : 244202108,
          );
          expect(report.bitmapPixelBytes).toBe(
            sample.nested ? 45805720 : 61128480,
          );
        } else {
          expect(report.bitmapPixelBytes).toBe(report.originalBitmapPixelBytes);
        }
        expect(report.maskPlacements).toBe(sample.masks);
        expect(
          report.actions
            .filter((action: { hitFrame?: number }) => action.hitFrame)
            .map((action: { hitFrame: number }) => action.hitFrame),
        ).toEqual(sample.hits);
      } finally {
        // 仅清理由本测试在解析后的临时目录根路径下创建的专属目录。
        if (
          dirname(realpathSync(directory)) !== temporaryRoot ||
          !basename(directory).startsWith("swf-rebuild-test-")
        ) {
          throw new Error("Unexpected temporary directory location");
        }
        rmSync(directory, { recursive: true });
      }
    },
    90000,
  );
});
