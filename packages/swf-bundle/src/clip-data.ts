import type { SwfClipData, SwfClipJson, ParsedSwfBundle, SwfSequence } from "./types.js";
import {
  atlasTileWarning,
  getMaxTextureSize,
} from "./max-texture-size.js";
import { prepareAtlasBitmap } from "./atlas.js";

export function extractPetId(fileName: string, fallbackName?: string): number {
  const fromFile = fileName.match(/ppets?_?(\d+)/i)?.[1];
  if (fromFile) return Number(fromFile);
  const fromName = fallbackName?.match(/(\d+)/)?.[1];
  return fromName ? Number(fromName) : 0;
}

function sequencesToJson(sequences: SwfSequence[]) {
  return sequences.map((seq) => ({
    name: seq.name,
    frames: seq.frames.map((frame) => ({
      labels: frame.labels,
      positions: Array.from(frame.mesh.positions),
      uvs: Array.from(frame.mesh.uvs),
      addColors: Array.from(frame.mesh.addColors),
      mulColors: Array.from(frame.mesh.mulColors),
      indices: Array.from(frame.mesh.indices),
      subMeshes: frame.mesh.subMeshes,
    })),
  }));
}

export function parsedBundleToJson(data: ParsedSwfBundle): SwfClipJson {
  return {
    petId: data.petId,
    name: data.name,
    frameRate: data.frameRate,
    atlasWidth: data.atlasWidth,
    atlasHeight: data.atlasHeight,
    materialWarnings: data.materialWarnings,
    atlasOriented: true,
    sequences: sequencesToJson(data.sequences),
  };
}

export function swfClipDataToJson(data: SwfClipData): SwfClipJson {
  const { atlas: _atlas, ...rest } = data;
  return {
    ...rest,
    atlasOriented: true,
    sequences: sequencesToJson(data.sequences),
  };
}

const ATLAS_TILE_WARNING_SUFFIX = "渲染时将分块加载";

export function isAtlasTileWarning(message: string): boolean {
  return message.includes(ATLAS_TILE_WARNING_SUFFIX);
}

/** 去掉加载时写入的过时图集分块提示（实际是否分块由运行时纹理上限决定） */
export function filterAtlasTileWarnings(warnings: string[]): string[] {
  return warnings.filter((w) => !isAtlasTileWarning(w));
}

export function appendAtlasTileWarning(
  warnings: string[],
  width: number,
  height: number,
  maxSide = getMaxTextureSize(),
): string[] {
  if (width <= maxSide && height <= maxSide) return warnings;
  const message = atlasTileWarning(width, height, maxSide);
  if (warnings.includes(message)) return warnings;
  return [...warnings, message];
}

/** @deprecated 保留兼容；新路径使用 appendAtlasTileWarning */
export function appendAtlasDownscaleWarning(
  warnings: string[],
  originalWidth: number,
  originalHeight: number,
  width: number,
  height: number,
): string[] {
  if (originalWidth === width && originalHeight === height) {
    return appendAtlasTileWarning(warnings, width, height);
  }
  return appendAtlasTileWarning(warnings, originalWidth, originalHeight);
}

export async function loadSwfClipPackage(
  meta: SwfClipJson,
  atlas: Blob | ImageBitmap,
  options?: { atlasPrepared?: boolean },
): Promise<SwfClipData> {
  const rawBitmap =
    typeof ImageBitmap !== "undefined" && atlas instanceof ImageBitmap
      ? atlas
      : await createImageBitmap(atlas as Blob);
  const prepared = options?.atlasPrepared
    ? {
        bitmap: rawBitmap,
        width: rawBitmap.width,
        height: rawBitmap.height,
        originalWidth: meta.atlasWidth,
        originalHeight: meta.atlasHeight,
        scaled:
          rawBitmap.width !== meta.atlasWidth ||
          rawBitmap.height !== meta.atlasHeight,
      }
    : await prepareAtlasBitmap(rawBitmap, meta.atlasWidth, meta.atlasHeight);

  return {
    petId: meta.petId,
    name: meta.name,
    frameRate: meta.frameRate,
    atlasWidth: meta.atlasWidth,
    atlasHeight: meta.atlasHeight,
    atlas: prepared.bitmap,
    materialWarnings: filterAtlasTileWarnings(meta.materialWarnings),
    sequences: meta.sequences.map((seq) => ({
      name: seq.name,
      frames: seq.frames.map((frame) => ({
        labels: frame.labels,
        mesh: {
          positions: new Float32Array(frame.positions),
          uvs: new Float32Array(frame.uvs),
          addColors: new Float32Array(frame.addColors),
          mulColors: new Float32Array(frame.mulColors),
          indices: new Uint16Array(frame.indices),
          subMeshes: frame.subMeshes,
        },
      })),
    })),
  };
}
