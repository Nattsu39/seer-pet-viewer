import "./buffer-setup.js";
import {
  loadAssetBundle,
  AssetType,
  type AssetFile,
  type MonoBehaviour,
} from "@arkntools/unity-js";
import { atlasPixelsToBitmap } from "./atlas.js";
import {
  captureAtlasTextureSource,
  decodeAtlasFromSource,
  decodeAtlasWhole,
  findAtlasTexture,
} from "./atlas-decode.js";
import { buildFrameMesh } from "./mesh.js";
import { MaterialResolver, NORMAL_MATERIAL } from "./material.js";
import { extractPetId, isSwfAtlasReleased } from "./clip-data.js";
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

export interface ParseBundleCoreOptions {
  /** false 时跳过图集解码（图集仍存活的重解析用），宽高仍返回 */
  needAtlas?: boolean;
  /** true 时只解码图集，跳过 SwfClipAsset 与帧构建 */
  atlasOnly?: boolean;
}

/**
 * 解码前清空 unity-js BundleFile 对大缓冲的全部引用。
 * Asset 对象经由 ObjectInfo→Asset.reader 持有各自文件的完整 ArrayBuffer，
 * 而 MaterialResolver 在 addFromBundle 时就提取了纯数据、不再保留对象，
 * 因此清空 files/objects/objectMap 后，70 MB 级的解包副本即可在解码阶段被回收，
 * 解码期间只余纹理 rawData（64 MB）与输出整图。
 */
function releaseBundleBuffers(bundle: AssetFile): void {
  const b = bundle as unknown as {
    files?: ArrayBuffer[];
    objects?: unknown[];
    objectMap?: Map<unknown, unknown>;
  };
  if (b.files) b.files.length = 0;
  if (b.objects) b.objects.length = 0;
  b.objectMap?.clear();
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

function buildSequences(
  tree: SwfClipAssetTree,
  resolver: MaterialResolver,
): SwfSequence[] {
  return tree.Sequences.map((seq) => ({
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
}

export async function parseBundleCore(
  data: ArrayBuffer | Uint8Array,
  fileName = "bundle",
  resolver = new MaterialResolver(),
  options: ParseBundleCoreOptions = {},
): Promise<ParsedSwfBundle> {
  const bundle = await loadAssetBundle(data);
  for (const obj of bundle.objects) {
    if (obj.type === AssetType.Material) {
      resolver.addFromBundle([obj as import("@arkntools/unity-js").Material]);
    }
  }

  // 先完成所有经由 reader 的懒读取（材质、类型树、帧数据），
  // 再捕获纹理源并清空 bundle 缓冲，解码阶段不再有多余整包副本驻留。
  if (options.atlasOnly) {
    const texture = findAtlasTexture(bundle);
    if (!texture) throw new Error("未找到 Texture2D 图集");
    const source = captureAtlasTextureSource(texture);
    releaseBundleBuffers(bundle);
    return {
      petId: extractPetId(fileName),
      name: "",
      frameRate: 0,
      atlasWidth: source.width,
      atlasHeight: source.height,
      atlasPixels: decodeFromSource(source, texture),
      sequences: [],
      materialWarnings: resolver.drainWarnings(),
    };
  }

  const { tree } = findSwfClipAsset(bundle);
  const sequences = buildSequences(tree, resolver);

  const texture = findAtlasTexture(bundle);
  if (!texture) throw new Error("未找到 Texture2D 图集");
  const source = captureAtlasTextureSource(texture);
  const { width, height } = source;
  releaseBundleBuffers(bundle);

  if (options.needAtlas === false) {
    return {
      petId: extractPetId(fileName, tree.Name),
      name: tree.Name,
      frameRate: tree.FrameRate,
      atlasWidth: width,
      atlasHeight: height,
      sequences,
      materialWarnings: resolver.drainWarnings(),
    };
  }

  return {
    petId: extractPetId(fileName, tree.Name),
    name: tree.Name,
    frameRate: tree.FrameRate,
    atlasWidth: width,
    atlasHeight: height,
    atlasPixels: decodeFromSource(source, texture),
    sequences,
    materialWarnings: resolver.drainWarnings(),
  };
}

function decodeFromSource(
  source: ReturnType<typeof captureAtlasTextureSource>,
  texture: NonNullable<ReturnType<typeof findAtlasTexture>>,
): import("./atlas.js").AtlasPixels {
  // 常见格式（BC*/ETC*/ASTC/RGBA32）全部从 source 解码，不保留 texture 引用；
  // 仅 PVRTC/ATC 等罕见格式回退到 unity-js 整图懒解码
  const fromSource = decodeAtlasFromSource(source);
  if (fromSource) return fromSource;
  return decodeAtlasWhole(texture);
}

export async function parseBundle(
  data: ArrayBuffer | Uint8Array,
  fileName = "bundle",
  resolver = new MaterialResolver(),
): Promise<SwfClipData> {
  const core = await parseBundleCore(data, fileName, resolver);
  if (!core.atlasPixels) {
    throw new Error("parseBundleCore 未返回图集像素");
  }
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

/**
 * 从 bundle 仅提取图集位图（分块渲染释放原图集后的 remount / 材质重解析用）。
 * 浏览器环境走解析 Worker（重解码的 ~256 MB 峰值随 Worker 终止归还，
 * 且不会在主线程留下永不回收的 wasm 线性内存）；无 Worker 环境回退主线程。
 */
export async function extractAtlasBitmapFromBundle(
  data: ArrayBuffer | Uint8Array,
): Promise<ImageBitmap> {
  const { extractAtlasBitmapInWorker, parserWorkerAvailable } = await import(
    "./worker-client.js"
  );
  const buffer = data instanceof ArrayBuffer ? data : data.slice().buffer;
  if (parserWorkerAvailable()) {
    return extractAtlasBitmapInWorker(buffer);
  }
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

/**
 * 在已加载共享材质后，复用现有图集重新解析 mesh 材质。
 * UI 侧请优先使用 worker 版本 `reparseSwfClipInWorker`（不在主线程触发解码）；
 * 本函数保留给无 Worker 环境（node 测试）与调试用途。
 */
export async function reparseSwfClip(
  data: ArrayBuffer | Uint8Array,
  fileName: string,
  resolver: MaterialResolver,
  atlas: ImageBitmap,
): Promise<SwfClipData> {
  const needAtlas = isSwfAtlasReleased(atlas);
  const core = await parseBundleCore(data, fileName, resolver, { needAtlas });
  let atlasBitmap = atlas;
  if (needAtlas) {
    if (!core.atlasPixels) {
      throw new Error("图集恢复失败：解析未返回图集像素");
    }
    const prepared = await atlasPixelsToBitmap(core.atlasPixels);
    atlasBitmap = prepared.bitmap;
  }
  const { atlasPixels: _pixels, materialWarnings, ...rest } = core;
  return {
    ...rest,
    atlas: atlasBitmap,
    materialWarnings,
  };
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
  releaseBundleBuffers(bundle);
  return {
    count: materials.length,
    warnings: resolver.drainWarnings(),
  };
}
