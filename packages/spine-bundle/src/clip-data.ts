import type { SpineClipData, SpineClipJson } from "./types.js";
import { scaleSpineAtlasText } from "./atlas-scale.js";
import {
  atlasPixelsToBitmap,
  parseAtlasUsesPma,
  prepareSpineAtlasBitmap,
} from "./atlas.js";

function pageScale(
  originalWidth: number,
  originalHeight: number,
  width: number,
  height: number,
): number {
  if (originalWidth === width && originalHeight === height) return 1;
  return width / originalWidth;
}

export async function buildSpineClipData(
  meta: SpineClipJson,
  skeletonBytes: Uint8Array,
  textureBuffers: Array<{
    name: string;
    width: number;
    height: number;
    rgba: Uint8ClampedArray;
  }>,
): Promise<SpineClipData> {
  const pma = parseAtlasUsesPma(meta.atlasText);
  const textures = new Map<string, ImageBitmap>();
  const pageScales = new Map<string, number>();
  for (const tex of textureBuffers) {
    const prepared = await atlasPixelsToBitmap(
      {
        width: tex.width,
        height: tex.height,
        rgba: tex.rgba,
      },
      { pma },
    );
    textures.set(tex.name, prepared.bitmap);
    pageScales.set(
      tex.name,
      pageScale(tex.width, tex.height, prepared.width, prepared.height),
    );
  }

  return {
    petId: meta.petId,
    name: meta.name,
    skeletonBytes,
    atlasText: scaleSpineAtlasText(meta.atlasText, pageScales),
    textures,
    animations: meta.animations,
    scale: meta.scale,
    defaultMix: meta.defaultMix,
  };
}

export async function loadSpineClipPackage(
  meta: SpineClipJson,
  skeletonBytes: ArrayBuffer | Uint8Array,
  textureBitmaps: Map<string, ImageBitmap>,
): Promise<SpineClipData> {
  const pma = parseAtlasUsesPma(meta.atlasText);
  const textures = new Map<string, ImageBitmap>();
  const pageScales = new Map<string, number>();
  for (const [name, bitmap] of textureBitmaps) {
    const texMeta = meta.textures.find((t) => t.name === name);
    if (!texMeta) {
      throw new Error(`meta.json 缺少纹理尺寸: ${name}`);
    }
    const prepared = await prepareSpineAtlasBitmap(
      bitmap,
      texMeta.width,
      texMeta.height,
      pma,
    );
    textures.set(name, prepared.bitmap);
    pageScales.set(
      name,
      pageScale(texMeta.width, texMeta.height, prepared.width, prepared.height),
    );
  }
  const skeleton =
    skeletonBytes instanceof Uint8Array
      ? skeletonBytes
      : new Uint8Array(skeletonBytes);
  return {
    petId: meta.petId,
    name: meta.name,
    skeletonBytes: skeleton,
    atlasText: scaleSpineAtlasText(meta.atlasText, pageScales),
    textures,
    animations: meta.animations,
    scale: meta.scale,
    defaultMix: meta.defaultMix,
  };
}

export function closeSpineClipData(clip: SpineClipData): void {
  for (const bitmap of clip.textures.values()) {
    bitmap.close();
  }
}
