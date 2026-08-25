import "./buffer-setup.js";
import { atlasPixelsToBitmap, type AtlasPixels } from "./atlas.js";
import { MaterialResolver } from "./material.js";
import { parseBundleCore } from "./parse.js";
import type { ParserWorkerMode } from "./worker-protocol.js";
import {
  encodeParsedSwfBundle,
  encodeSwfBundleFrames,
} from "./worker-protocol.js";
import type { SwfMaterialState } from "./types.js";

export interface WorkerRequest {
  id: number;
  buffer: ArrayBuffer;
  mode?: ParserWorkerMode;
  fileName?: string;
  materials?: Record<string, SwfMaterialState>;
}

/**
 * 在 Worker 内完成 padding 处理并位图化图集。
 * 这样 256 MiB 级的 RGBA buffer 不再进入主线程堆，
 * 而是随 Worker 终止一起归还；主线程只收到可直接上传 GPU 的 ImageBitmap。
 * 环境不支持时返回 null，由调用方回退成传输 RGBA buffer。
 */
async function createAtlasBitmap(
  pixels: AtlasPixels,
): Promise<ImageBitmap | null> {
  if (typeof createImageBitmap !== "function") return null;
  try {
    const prepared = await atlasPixelsToBitmap(pixels);
    return prepared.bitmap;
  } catch {
    // prepareAtlasRgba 是幂等的，因此回退路径可以安全地在主线程重做一次
    return null;
  }
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, buffer, mode = "full", fileName, materials } = event.data;
  try {
    const resolver = new MaterialResolver();
    if (materials) resolver.restore(materials);

    if (mode === "atlas") {
      const core = await parseBundleCore(buffer, fileName ?? "bundle", resolver, {
        atlasOnly: true,
      });
      if (!core.atlasPixels) throw new Error("图集提取未返回像素");
      const atlasBitmap = await createAtlasBitmap(core.atlasPixels);
      if (atlasBitmap) {
        self.postMessage({ id, ok: true, atlasBitmap }, [atlasBitmap]);
        return;
      }
      const encoded = encodeParsedSwfBundle(core);
      self.postMessage(
        {
          id,
          ok: true,
          descriptor: encoded.descriptor,
          floatBuffer: encoded.floatBuffer,
          uintBuffer: encoded.uintBuffer,
          atlasBuffer: encoded.atlasBuffer,
        },
        [encoded.floatBuffer, encoded.uintBuffer, encoded.atlasBuffer],
      );
      return;
    }

    const needAtlas = mode !== "frames";
    const core = await parseBundleCore(buffer, fileName ?? "bundle", resolver, {
      needAtlas,
    });

    if (!needAtlas) {
      const encoded = encodeSwfBundleFrames(core);
      self.postMessage(
        {
          id,
          ok: true,
          descriptor: encoded.descriptor,
          floatBuffer: encoded.floatBuffer,
          uintBuffer: encoded.uintBuffer,
        },
        [encoded.floatBuffer, encoded.uintBuffer],
      );
      return;
    }

    if (!core.atlasPixels) throw new Error("解析未返回图集像素");
    const atlasBitmap = await createAtlasBitmap(core.atlasPixels);

    if (atlasBitmap) {
      const encoded = encodeSwfBundleFrames(core);
      self.postMessage(
        {
          id,
          ok: true,
          descriptor: encoded.descriptor,
          floatBuffer: encoded.floatBuffer,
          uintBuffer: encoded.uintBuffer,
          atlasBitmap,
        },
        [encoded.floatBuffer, encoded.uintBuffer, atlasBitmap],
      );
      return;
    }

    const encoded = encodeParsedSwfBundle(core);
    self.postMessage(
      {
        id,
        ok: true,
        descriptor: encoded.descriptor,
        floatBuffer: encoded.floatBuffer,
        uintBuffer: encoded.uintBuffer,
        atlasBuffer: encoded.atlasBuffer,
      },
      [encoded.floatBuffer, encoded.uintBuffer, encoded.atlasBuffer],
    );
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
