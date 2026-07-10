import "./buffer-setup.js";
import {
  loadAssetBundle,
  AssetType,
  type AssetFile,
  type MonoBehaviour,
  type Texture2D,
} from "@arkntools/unity-js";
import { atlasPixelsToBitmap, flipAtlasY, type AtlasPixels } from "./atlas.js";
import { buildFrameMesh } from "./mesh.js";
import { MaterialResolver, NORMAL_MATERIAL } from "./material.js";
import { extractPetId } from "./clip-data.js";
import type {
  SwfClipData,
  SwfFrame,
  SwfSequence,
  ParsedSwfBundle,
} from "./types.js";

interface RawFrame {
  Labels: string[];
  MeshData: Parameters<typeof buildFrameMesh>[0];
  Materials: Array<{ m_FileID: number; m_PathID: number | bigint }>;
}

interface RawSequence {
  Name: string;
  Frames: RawFrame[];
}

interface SwfClipAssetTree {
  Name: string;
  FrameRate: number;
  Sprite: { m_FileID: number; m_PathID: number | bigint };
  Sequences: RawSequence[];
}

function loadAtlasPixels(bundle: AssetFile): AtlasPixels {
  let texture: Texture2D | undefined;
  for (const obj of bundle.objects) {
    if (obj.type === AssetType.Texture2D) {
      texture = obj as Texture2D;
      break;
    }
  }
  if (!texture) {
    throw new Error("未找到 Texture2D 图集");
  }
  const tex = texture as unknown as {
    width: number;
    height: number;
    image: { data: Uint8Array };
  };
  const raw = new Uint8ClampedArray(tex.image.data);
  return {
    width: tex.width,
    height: tex.height,
    rgba: flipAtlasY(raw, tex.width, tex.height),
  };
}

function findSwfClipAsset(bundle: AssetFile): {
  mb: MonoBehaviour;
  tree: SwfClipAssetTree;
} {
  for (const obj of bundle.objects) {
    if (obj.type !== AssetType.MonoBehaviour) continue;
    const mb = obj as MonoBehaviour;
    const script = mb.script.object;
    if (script?.className !== "SwfClipAsset") continue;
    return { mb, tree: mb.getTypeTree() as SwfClipAssetTree };
  }
  throw new Error("未找到 SwfClipAsset");
}

export async function parseBundleCore(
  data: ArrayBuffer | Uint8Array,
  fileName = "bundle",
  resolver = new MaterialResolver(),
): Promise<ParsedSwfBundle> {
  const bundle = await loadAssetBundle(data);
  for (const obj of bundle.objects) {
    if (obj.type === AssetType.Material) {
      resolver.addFromBundle([obj as import("@arkntools/unity-js").Material]);
    }
  }

  const { tree } = findSwfClipAsset(bundle);
  const atlasPixels = loadAtlasPixels(bundle);
  const materialWarnings = resolver.drainWarnings();
  const sequences: SwfSequence[] = tree.Sequences.map((seq) => ({
    name: seq.Name,
    frames: seq.Frames.map((frame) => {
      const materials = frame.Materials?.length
        ? frame.Materials.map((m, i) =>
            resolver.resolveMaterialRef(m.m_FileID, BigInt(m.m_PathID), i),
          )
        : [NORMAL_MATERIAL];
      const materialPathIds = frame.Materials?.length
        ? frame.Materials.map((m) => String(m.m_PathID))
        : undefined;
      const mesh = buildFrameMesh(frame.MeshData, materials, materialPathIds);
      return {
        labels: frame.Labels ?? [],
        mesh,
      } satisfies SwfFrame;
    }),
  }));

  const petId = extractPetId(fileName, tree.Name);

  return {
    petId,
    name: tree.Name,
    frameRate: tree.FrameRate,
    atlasWidth: atlasPixels.width,
    atlasHeight: atlasPixels.height,
    atlasPixels,
    sequences,
    materialWarnings,
  };
}

export async function parseBundle(
  data: ArrayBuffer | Uint8Array,
  fileName = "bundle",
  resolver = new MaterialResolver(),
): Promise<SwfClipData> {
  const core = await parseBundleCore(data, fileName, resolver);
  const prepared = await atlasPixelsToBitmap(core.atlasPixels);
  const { atlasPixels: _pixels, materialWarnings, ...rest } = core;
  return {
    ...rest,
    atlas: prepared.bitmap,
    atlasWidth: prepared.width,
    atlasHeight: prepared.height,
    materialWarnings,
  };
}

/** 在已加载共享材质后，复用现有图集重新解析 mesh 材质 */
export async function reparseSwfClip(
  data: ArrayBuffer | Uint8Array,
  fileName: string,
  resolver: MaterialResolver,
  atlas: ImageBitmap,
): Promise<SwfClipData> {
  const core = await parseBundleCore(data, fileName, resolver);
  const { atlasPixels: _pixels, ...rest } = core;
  return { ...rest, atlas };
}

export async function loadMaterialBundle(
  buffer: ArrayBuffer,
  resolver: MaterialResolver,
): Promise<{ count: number; warnings: string[] }> {
  const bundle = await loadAssetBundle(buffer);
  const materials = bundle.objects.filter(
    (o) => o.type === AssetType.Material,
  ) as import("@arkntools/unity-js").Material[];
  resolver.addFromBundle(materials);
  return {
    count: materials.length,
    warnings: resolver.drainWarnings(),
  };
}
