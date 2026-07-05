import "./buffer-setup.js";
import {
  loadAssetBundle,
  AssetType,
  type Material,
  type MonoBehaviour,
  type TextAsset,
} from "@arkntools/unity-js";
import { imgBitMapToPixels } from "./atlas.js";
import { buildSpineClipData } from "./clip-data.js";
import { extractSpinePetId } from "./pet-id.js";
import { loadBundleTexturePixels } from "./texture-loader.js";
import type {
  BundleKind,
  ParsedSpineBundle,
  SpineClipData,
  SpineClipJson,
} from "./types.js";

interface SkeletonDataTree {
  scale?: number;
  defaultMix?: number;
  m_Name?: string;
  Name?: string;
}

interface AnimationRefTree {
  animationName?: string;
}

type UnityBundle = Awaited<ReturnType<typeof loadAssetBundle>>;

export async function detectBundleKind(
  data: ArrayBuffer | Uint8Array,
): Promise<BundleKind> {
  const bundle = await loadAssetBundle(data);
  let hasSwf = false;
  let hasSpine = false;
  let hasVideo = false;

  for (const obj of bundle.objects) {
    if ((obj.type as number) === AssetType.VideoClip) hasVideo = true;
    if (obj.type !== AssetType.MonoBehaviour) continue;
    const mb = obj as MonoBehaviour;
    const className = mb.script.object?.className;
    if (className === "SwfClipAsset") hasSwf = true;
    if (className === "SkeletonDataAsset") hasSpine = true;
  }

  if (hasSpine) return "spine";
  if (hasSwf) return "swf";
  if (hasVideo) return "video";
  return "unknown";
}

function readSkeletonAsset(bundle: UnityBundle): {
  mb: MonoBehaviour;
  tree: SkeletonDataTree;
} {
  for (const obj of bundle.objects) {
    if (obj.type !== AssetType.MonoBehaviour) continue;
    const mb = obj as MonoBehaviour;
    if (mb.script.object?.className !== "SkeletonDataAsset") continue;
    return { mb, tree: mb.getTypeTree() as SkeletonDataTree };
  }
  throw new Error("未找到 Spine SkeletonDataAsset");
}

function collectAnimationNames(bundle: UnityBundle): string[] {
  const names: string[] = [];
  for (const obj of bundle.objects) {
    if (obj.type !== AssetType.MonoBehaviour) continue;
    const mb = obj as MonoBehaviour;
    if (mb.script.object?.className !== "AnimationReferenceAsset") continue;
    const tree = mb.getTypeTree() as AnimationRefTree;
    if (tree.animationName) names.push(tree.animationName);
  }
  return [...new Set(names)];
}

function atlasPageNames(atlasText: string): string[] {
  return atlasText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /\.png$/i.test(line));
}

function readTextAssetBytes(asset: TextAsset): Uint8Array {
  return new Uint8Array(asset.data);
}

function loadTexturesFromMaterials(
  mb: MonoBehaviour,
): ParsedSpineBundle["texturePixels"] {
  const results: ParsedSpineBundle["texturePixels"] = [];
  for (const atlasRef of mb.atlasAssets ?? []) {
    const atlasMb = atlasRef.object;
    if (!atlasMb?.materials?.length) continue;
    for (const matRef of atlasMb.materials) {
      const material = matRef.object as Material | undefined;
      if (!material) continue;
      const imageName = material.getImageName();
      if (!imageName) continue;
      const jimp = material.getImageJimp();
      const bitmap = jimp?.bitmap;
      if (!bitmap) continue;
      const pixels = imgBitMapToPixels({
        data: bitmap.data.buffer as ArrayBuffer,
        width: bitmap.width,
        height: bitmap.height,
      });
      results.push({
        name: `${imageName}.png`,
        width: pixels.width,
        height: pixels.height,
        rgba: pixels.rgba,
      });
    }
  }
  return results;
}

function readSpineTextAssets(mb: MonoBehaviour): {
  skeletonBytes: Uint8Array;
  atlasText: string;
} {
  const skelAsset = mb.skeletonJSON?.object;
  if (!skelAsset) {
    throw new Error("未找到 skeletonJSON 文本资源");
  }

  const atlasMb = mb.atlasAssets?.[0]?.object;
  const atlasFile = atlasMb?.atlasFile?.object;
  if (!atlasFile) {
    throw new Error("未找到 atlas 文本资源");
  }

  const atlasText = new TextDecoder().decode(atlasFile.data);
  if (!atlasPageNames(atlasText).length) {
    throw new Error("atlas 中未找到纹理页");
  }

  return {
    skeletonBytes: readTextAssetBytes(skelAsset),
    atlasText,
  };
}

async function loadSpineTexturePixels(
  mb: MonoBehaviour,
  bundle: UnityBundle,
  atlasText: string,
): Promise<ParsedSpineBundle["texturePixels"]> {
  const expected = new Set(atlasPageNames(atlasText));
  try {
    const fromBundle = loadBundleTexturePixels(bundle, expected);
    if (fromBundle.length >= expected.size) {
      return fromBundle.map(({ name, width, height, rgba }) => ({
        name,
        width,
        height,
        rgba,
      }));
    }
  } catch {
    // unity-js 对部分 Unity 版本会误读 streamData，回退到 Material / getSpine 路径
  }

  const spineWithBitmap = await mb.getSpine(true);
  if (spineWithBitmap && Object.keys(spineWithBitmap.image).length > 0) {
    return Object.entries(spineWithBitmap.image).map(([name, bitmap]) => {
      const pixels = imgBitMapToPixels(bitmap);
      return {
        name,
        width: pixels.width,
        height: pixels.height,
        rgba: pixels.rgba,
      };
    });
  }

  const fromMaterials = loadTexturesFromMaterials(mb);
  if (fromMaterials.length) return fromMaterials;

  const fallback = loadBundleTexturePixels(bundle);
  return fallback.map(({ name, width, height, rgba }) => ({
    name,
    width,
    height,
    rgba,
  }));
}

async function extractSpineResources(
  mb: MonoBehaviour,
  bundle: UnityBundle,
): Promise<{
  skeletonBytes: Uint8Array;
  atlasText: string;
  texturePixels: ParsedSpineBundle["texturePixels"];
}> {
  const { skeletonBytes, atlasText } = readSpineTextAssets(mb);
  const texturePixels = await loadSpineTexturePixels(mb, bundle, atlasText);
  if (!texturePixels.length) {
    throw new Error("Spine 纹理解析失败");
  }
  return { skeletonBytes, atlasText, texturePixels };
}

export async function parseSpineBundleMetadata(
  data: ArrayBuffer | Uint8Array,
  fileName = "bundle",
): Promise<Omit<ParsedSpineBundle, "texturePixels">> {
  const bundle = await loadAssetBundle(data);
  const { mb, tree } = readSkeletonAsset(bundle);
  if (!mb.skeletonJSON?.object || !mb.atlasAssets?.length) {
    throw new Error("SkeletonDataAsset 缺少 Spine 骨骼或图集数据");
  }

  const { skeletonBytes, atlasText } = readSpineTextAssets(mb);
  const displayName = tree.m_Name ?? tree.Name ?? mb.name ?? "spine";

  return {
    petId: extractSpinePetId(fileName, displayName),
    name: displayName,
    skeletonBytes,
    atlasText,
    animations: collectAnimationNames(bundle),
    scale: typeof tree.scale === "number" ? tree.scale : 0.01,
    defaultMix: typeof tree.defaultMix === "number" ? tree.defaultMix : 0.2,
  };
}

export async function parseSpineBundleCore(
  data: ArrayBuffer | Uint8Array,
  fileName = "bundle",
): Promise<ParsedSpineBundle> {
  const bundle = await loadAssetBundle(data);
  const { mb, tree } = readSkeletonAsset(bundle);
  if (!mb.skeletonJSON?.object || !mb.atlasAssets?.length) {
    throw new Error("SkeletonDataAsset 缺少 Spine 骨骼或图集数据");
  }

  const { skeletonBytes, atlasText, texturePixels } =
    await extractSpineResources(mb, bundle);

  if (!texturePixels.length) {
    throw new Error("未找到 Spine 纹理页");
  }

  const displayName = tree.m_Name ?? tree.Name ?? mb.name ?? "spine";
  const animations = collectAnimationNames(bundle);
  const petId = extractSpinePetId(fileName, displayName);

  return {
    petId,
    name: displayName,
    skeletonBytes,
    atlasText,
    texturePixels,
    animations,
    scale: typeof tree.scale === "number" ? tree.scale : 0.01,
    defaultMix: typeof tree.defaultMix === "number" ? tree.defaultMix : 0.2,
  };
}

export function parsedSpineToJson(data: ParsedSpineBundle): SpineClipJson {
  return {
    petId: data.petId,
    name: data.name,
    atlasText: data.atlasText,
    animations: data.animations,
    scale: data.scale,
    defaultMix: data.defaultMix,
    textures: data.texturePixels.map(({ name, width, height }) => ({
      name,
      width,
      height,
    })),
  };
}

export async function parseSpineBundle(
  data: ArrayBuffer | Uint8Array,
  fileName = "bundle",
): Promise<SpineClipData> {
  const core = await parseSpineBundleCore(data, fileName);
  const meta: SpineClipJson = {
    petId: core.petId,
    name: core.name,
    atlasText: core.atlasText,
    animations: core.animations,
    scale: core.scale,
    defaultMix: core.defaultMix,
    textures: core.texturePixels.map((tex) => ({
      name: tex.name,
      width: tex.width,
      height: tex.height,
    })),
  };
  return buildSpineClipData(meta, core.skeletonBytes, core.texturePixels);
}
