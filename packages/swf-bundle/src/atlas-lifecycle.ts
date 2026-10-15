import { atlasPixelsToBitmap } from "./atlas.js";
import { isSwfAtlasReleased } from "./clip-data.js";
import { MaterialResolver } from "./material.js";
import type { SwfClipData } from "./types.js";

/**
 * 从 bundle 仅提取图集位图（分块渲染释放原图集后的 remount / 材质重解析用）。
 * 浏览器环境走解析 Worker（重解码的 ~256 MB 峰值随 Worker 终止归还，
 * 且不会在主线程留下永不回收的 wasm 线性内存）；无 Worker 环境回退主线程。
 */
export async function extractAtlasBitmapFromBundle(
  data: ArrayBuffer | Uint8Array,
): Promise<ImageBitmap> {
  const { extractAtlasBitmapInWorker, parserWorkerAvailable } =
    await import("./worker-client.js");
  const buffer = data instanceof ArrayBuffer ? data : data.slice().buffer;
  if (parserWorkerAvailable()) {
    return extractAtlasBitmapInWorker(buffer);
  }
  const { parseBundleCore } = await import("./parse.js");
  const core = await parseBundleCore(buffer, "bundle", new MaterialResolver(), {
    atlasOnly: true,
  });
  if (!core.atlasPixels) {
    throw new Error("图集提取失败");
  }
  const prepared = await atlasPixelsToBitmap(core.atlasPixels);
  return prepared.bitmap;
}

/** 分块渲染释放原图集后，在 remount 前从 bundle 恢复 */
export async function ensureSwfClipAtlas(
  clip: SwfClipData,
  bundleBuffer?: ArrayBuffer | null,
): Promise<void> {
  if (!isSwfAtlasReleased(clip.atlas)) return;
  if (!bundleBuffer) {
    throw new Error(
      "图集已在分块渲染后释放；请重新加载 bundle 或预转换 swfclip 包",
    );
  }
  clip.atlas = await extractAtlasBitmapFromBundle(bundleBuffer);
}
