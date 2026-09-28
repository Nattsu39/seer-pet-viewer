import type { AssetFile } from "@arkntools/unity-js";
import { Texture2D } from "@arkntools/unity-js";
import { decodeTexture } from "@arkntools/unity-js/utils/decodeTexture";
import { ArrayBufferReader } from "@arkntools/unity-js/utils/reader";
import { flipAtlasY, type AtlasPixels } from "./atlas.js";

interface StreamData {
  offset: number;
  size: number;
  path: string;
}

interface TextureTypeTree {
  m_StreamData?: {
    offset?: number | bigint;
    size?: number;
    path?: string;
  };
  m_CompleteImageSize?: number;
  m_Width?: number;
  m_Height?: number;
  width?: number;
  height?: number;
}

function readStreamFromBundle(
  bundle: AssetFile,
  stream: StreamData,
): Uint8Array {
  const fileName = stream.path.split("/").pop();
  if (!fileName) {
    throw new Error(`无效的纹理流路径: ${stream.path}`);
  }
  const index = bundle.nodes.findIndex(({ path }) => path === fileName);
  if (index === -1) {
    throw new Error(`未找到纹理流文件: ${fileName}`);
  }
  const reader = new ArrayBufferReader(bundle.files[index]);
  reader.seek(stream.offset);
  return new Uint8Array(reader.readBuffer(stream.size));
}

function getStreamData(texture: Texture2D): StreamData | undefined {
  if (texture.streamData?.path && texture.streamData.size > 0) {
    return texture.streamData;
  }

  const tree = texture.getTypeTree() as TextureTypeTree;
  const stream = tree.m_StreamData;
  if (!stream?.path || !stream.size) return undefined;

  return {
    offset: Number(stream.offset ?? 0),
    size: stream.size,
    path: stream.path,
  };
}

function getTextureDimensions(texture: Texture2D): {
  width: number;
  height: number;
} {
  const tree = texture.getTypeTree() as TextureTypeTree;
  return {
    width: tree.m_Width ?? tree.width ?? texture.width,
    height: tree.m_Height ?? tree.height ?? texture.height,
  };
}

function decodeTexturePixels(
  texture: Texture2D,
  rawData: Uint8Array,
): AtlasPixels {
  const { width, height } = getTextureDimensions(texture);
  const decoded = decodeTexture(
    rawData as Uint8Array<ArrayBuffer>,
    width,
    height,
    texture.textureFormat,
    texture.name,
  );
  const rgba = flipAtlasY(new Uint8ClampedArray(decoded), width, height);
  return { width, height, rgba };
}

function loadInlineTexturePixels(texture: Texture2D): AtlasPixels | undefined {
  try {
    const jimp = texture.getImageJimp();
    const bitmap = jimp?.bitmap;
    if (!bitmap) return undefined;
    const { width, height } = getTextureDimensions(texture);
    if (bitmap.data.length !== width * height * 4) return undefined;
    return {
      width,
      height,
      rgba: flipAtlasY(new Uint8ClampedArray(bitmap.data), width, height),
    };
  } catch {
    return undefined;
  }
}

export function loadTexture2DPixels(
  texture: Texture2D,
  bundle: AssetFile,
): AtlasPixels {
  const stream = getStreamData(texture);
  if (stream) {
    const raw = readStreamFromBundle(bundle, stream);
    return decodeTexturePixels(texture, raw);
  }

  const inline = loadInlineTexturePixels(texture);
  if (inline) return inline;

  throw new Error(`纹理 ${texture.name} 缺少可解码的图像数据`);
}

export function loadBundleTexturePixels(
  bundle: AssetFile,
  expectedNames?: Set<string>,
): Array<{ name: string } & AtlasPixels> {
  const textures: Array<{ name: string } & AtlasPixels> = [];

  for (const obj of bundle.objects) {
    if (!(obj instanceof Texture2D)) continue;
    const fileName = `${obj.name}.png`;
    if (expectedNames && !expectedNames.has(fileName)) continue;

    const pixels = loadTexture2DPixels(obj, bundle);
    textures.push({ name: fileName, ...pixels });
  }

  return textures;
}
