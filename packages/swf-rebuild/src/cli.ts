#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { rebuildPet } from "./rebuild.js";
import { loadUnityClip } from "./unity.js";
import { validateTextureScale } from "./textures.js";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      source: { type: "string" },
      bundle: { type: "string" },
      materials: { type: "string" },
      out: { type: "string" },
      previews: { type: "string" },
      help: { type: "boolean" },
      "texture-scale": { type: "string" },
    },
  });
  if (values.help) {
    console.log(
      "seer-swf-rebuild --source pet.swf --bundle ppets_ID.bundle --materials shared.bundle --out rebuilt.swf [--previews directory] [--texture-scale 1|0.5|0.25]\nActions, class bindings and coordinates are detected from the source SWF and bundle.\nTexture scale defaults to 1; reduced scales affect new bitmaps only, preserving geometry and animation.",
    );
    return;
  }
  const required = (key: "source" | "bundle" | "materials" | "out"): string => {
    const value = values[key];
    if (!value) throw new Error(`--${key} is required (see --help)`);
    return resolve(value);
  };
  const textureScale = validateTextureScale(
    Number(values["texture-scale"] ?? 1),
  );
  const sourcePath = required("source"),
    bundlePath = required("bundle"),
    materialsPath = required("materials"),
    output = required("out");
  if (
    [sourcePath, bundlePath, materialsPath].some(
      (path) => path.toLowerCase() === output.toLowerCase(),
    )
  ) {
    throw new Error("Output must not overwrite an input file");
  }
  const [source, bundle, materials] = await Promise.all(
    [sourcePath, bundlePath, materialsPath].map((path) => readFile(path)),
  );
  console.log("Decoding Unity clip and atlas...");
  const result = rebuildPet(source, await loadUnityClip(bundle, materials), {
    textureScale,
  });
  await mkdir(dirname(output), { recursive: true });
  // 以独占方式创建文件，避免重跑时覆盖已检查的输出。
  await writeFile(output, result.swf, { flag: "wx" });
  const digest = (data: Buffer): string =>
    createHash("sha256").update(data).digest("hex");
  await writeFile(
    `${output}.json`,
    `${JSON.stringify(
      {
        ...result.report,
        inputs: {
          source: sourcePath,
          bundle: bundlePath,
          materials: materialsPath,
          bundleSha256: digest(bundle),
          materialsSha256: digest(materials),
        },
      },
      null,
      2,
    )}\n`,
    { flag: "wx" },
  );
  if (values.previews) {
    const directory = resolve(values.previews);
    await mkdir(directory, { recursive: true });
    for (const [name, bytes] of result.previews) {
      await writeFile(
        resolve(
          directory,
          `${parse(output).name}-${encodeURIComponent(name)}.swf`,
        ),
        bytes,
        { flag: "wx" },
      );
    }
  }
  console.log(
    `Wrote ${output} (${result.swf.length} bytes, ${result.report.bitmapCount} bitmap regions)`,
  );
  console.log(
    `Texture scale: ${textureScale}; generated pixel bytes: ${result.report.originalBitmapPixelBytes} -> ${result.report.bitmapPixelBytes}`,
  );
  console.log(
    `Masks: ${result.report.maskShapeCount} shapes, ${result.report.maskPlacements} intervals`,
  );
  console.log(
    result.report.actions
      .map((action) => `${action.name}: ${action.frames} frames`)
      .join(", "),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
