import { AssetType, type AssetFile, type Texture2D } from "@arkntools/unity-js";
import { TextureFormat } from "@arkntools/unity-js/classes/types";
import {
  decodeAstc,
  decodeBc1,
  decodeBc3,
  decodeBc4,
  decodeBc5,
  decodeBc6Unsigned,
  decodeBc7,
  decodeEtc1,
  decodeEtc2Rgb,
  decodeEtc2Rgba1,
  decodeEtc2Rgba8,
} from "@arkntools/unity-js-tools";
import { flipAtlasYInPlace, type AtlasPixels } from "./atlas.js";

/**
 * 分条带解码 SWF 图集纹理。
 *
 * wasm 解码器（@arkntools/unity-js-tools）的整图解码有三份峰值拷贝：
 * 输入整图拷入 wasm 线性内存、wasm 内部分配整图输出、`.slice()` 整图拷回 JS 堆，
 * 8192 BC7 图集（64 MB 压缩 / 256 MB RGBA）实测仅这一步就抬升 ~830 MB 峰值，
 * 且 wasm 线性内存涨后不回收。
 * 按水平条带逐块解码后，wasm 侧只驻留单个条带（几 MB），输出整图只分配一份，
 * 并在拷贝行时顺带完成 Y 翻转与 BGRA→RGBA 换序。
 */

/** 条带目标高度（像素）。取块高的整数倍，4x4 块即 512 行、12x12 块即 504 行 */
const STRIP_TARGET_ROWS = 512;

/** wasm 解码器按块独立工作所需的信息；PVRTC/ATC/Crunched 等块间不独立的格式不在此列，走整图回退 */
interface BlockDecoder {
  blockWidth: number;
  blockHeight: number;
  bytesPerBlock: number;
  decode(data: Uint8Array, width: number, height: number): Uint8Array;
}

const block4 = (
  bytesPerBlock: number,
  decode: BlockDecoder["decode"],
): BlockDecoder => ({ blockWidth: 4, blockHeight: 4, bytesPerBlock, decode });

const astc = (size: number): BlockDecoder => ({
  blockWidth: size,
  blockHeight: size,
  bytesPerBlock: 16,
  decode: (data, width, height) => decodeAstc(data, width, height, size, size),
});

const BLOCK_DECODERS: ReadonlyMap<number, BlockDecoder> = new Map([
  [TextureFormat.DXT1, block4(8, decodeBc1)],
  [TextureFormat.DXT5, block4(16, decodeBc3)],
  [TextureFormat.BC4, block4(8, decodeBc4)],
  [TextureFormat.BC5, block4(16, decodeBc5)],
  [TextureFormat.BC6H, block4(16, decodeBc6Unsigned)],
  [TextureFormat.BC7, block4(16, decodeBc7)],
  [TextureFormat.ETC_RGB4, block4(8, decodeEtc1)],
  [TextureFormat.ETC2_RGB, block4(8, decodeEtc2Rgb)],
  [TextureFormat.ETC2_RGBA1, block4(8, decodeEtc2Rgba1)],
  [TextureFormat.ETC2_RGBA8, block4(16, decodeEtc2Rgba8)],
  [TextureFormat.ASTC_RGB_4x4, astc(4)],
  [TextureFormat.ASTC_RGB_5x5, astc(5)],
  [TextureFormat.ASTC_RGB_6x6, astc(6)],
  [TextureFormat.ASTC_RGB_8x8, astc(8)],
  [TextureFormat.ASTC_RGB_10x10, astc(10)],
  [TextureFormat.ASTC_RGB_12x12, astc(12)],
  [TextureFormat.ASTC_RGBA_4x4, astc(4)],
  [TextureFormat.ASTC_RGBA_5x5, astc(5)],
  [TextureFormat.ASTC_RGBA_6x6, astc(6)],
  [TextureFormat.ASTC_RGBA_8x8, astc(8)],
  [TextureFormat.ASTC_RGBA_10x10, astc(10)],
  [TextureFormat.ASTC_RGBA_12x12, astc(12)],
  [TextureFormat.ASTC_HDR_4x4, astc(4)],
  [TextureFormat.ASTC_HDR_5x5, astc(5)],
  [TextureFormat.ASTC_HDR_6x6, astc(6)],
  [TextureFormat.ASTC_HDR_8x8, astc(8)],
  [TextureFormat.ASTC_HDR_10x10, astc(10)],
  [TextureFormat.ASTC_HDR_12x12, astc(12)],
]);

/**
 * 捕获图集纹理的解码输入。必须在任何 `.image.data` 访问之前调用：
 * 访问 `.data` 会触发 unity-js 的整图懒解码（正是要避开的路径）。
 * 捕获后即可丢弃 Texture2D 对象、清空 bundle 缓冲，
 * 解码期间不再有 files/raw 之外的 70 MB 级副本驻留。
 */
export interface AtlasTextureSource {
  width: number;
  height: number;
  format: number;
  /** 压缩原始数据；`.data` 已被访问过时为解码后的 RGBA（此时走整图回退） */
  raw?: Uint8Array;
  /** raw 已经是 unity-js 解码输出（RGBA、未翻转）时为 true */
  alreadyDecoded: boolean;
}

interface TextureDecoderInternals {
  rawData?: Uint8Array;
  decoded?: boolean;
}

export function findAtlasTexture(bundle: AssetFile): Texture2D | undefined {
  for (const obj of bundle.objects) {
    if (obj.type === AssetType.Texture2D) return obj as Texture2D;
  }
  return undefined;
}

/** 零解码读取纹理的宽高/格式/原始压缩数据 */
export function captureAtlasTextureSource(
  texture: Texture2D,
): AtlasTextureSource {
  const internals = (texture as unknown as { image: TextureDecoderInternals })
    .image;
  return {
    width: texture.width,
    height: texture.height,
    format: texture.textureFormat,
    raw: internals?.rawData,
    alreadyDecoded: internals?.decoded === true,
  };
}

function stripDecoderFor(
  source: AtlasTextureSource,
): BlockDecoder | undefined {
  if (source.alreadyDecoded || !source.raw) return undefined;
  const decoder = BLOCK_DECODERS.get(source.format);
  if (!decoder) return undefined;
  const blocksW = Math.ceil(source.width / decoder.blockWidth);
  const blocksH = Math.ceil(source.height / decoder.blockHeight);
  if (source.raw.length !== blocksW * blocksH * decoder.bytesPerBlock) {
    return undefined;
  }
  return decoder;
}

/**
 * 把条带解码结果拷进整图输出：Y 翻转行序 + BGRA→RGBA 换序。
 * 用 Uint32 视图按像素交换 byte0/byte2（小端下即 B↔R），比逐字节写快数倍。
 */
function copyStripRows(
  out: Uint8ClampedArray,
  src: Uint8Array,
  width: number,
  height: number,
  y0: number,
  rows: number,
): void {
  const rowPixels = width;
  const out32 = new Uint32Array(
    out.buffer,
    out.byteOffset,
    out.byteLength / 4,
  );
  const src32 = new Uint32Array(
    src.buffer,
    src.byteOffset,
    src.byteLength / 4,
  );
  for (let r = 0; r < rows; r++) {
    let s = r * rowPixels;
    let d = (height - 1 - (y0 + r)) * rowPixels;
    for (let i = 0; i < rowPixels; i++) {
      const v = src32[s++];
      // 保留 A、G（byte3、byte1），交换 B、R（byte0、byte2）
      out32[d++] = (v & 0xff00ff00) | ((v & 0xff) << 16) | ((v >>> 16) & 0xff);
    }
  }
}

/** 条带路径是否可用；测试用它做整图/条带奇偶校验 */
export function canDecodeAtlasStrips(source: AtlasTextureSource): boolean {
  return stripDecoderFor(source) !== undefined;
}

/**
 * 条带解码：输出整图只分配一份，wasm 只见单条带。
 * 返回值已翻转、已换序为 RGBA，可直接作为图集像素。
 */
export function decodeAtlasStrips(
  source: AtlasTextureSource,
): AtlasPixels | null {
  const decoder = stripDecoderFor(source);
  if (!decoder) return null;
  const { width, height, raw } = source;
  const rowBytes = width * 4;
  const out = new Uint8ClampedArray(rowBytes * height);
  const blocksPerRow = Math.ceil(width / decoder.blockWidth);
  const blockRowsPerStrip = Math.ceil(
    STRIP_TARGET_ROWS / decoder.blockHeight,
  );
  const stripRows = blockRowsPerStrip * decoder.blockHeight;
  const stripBytes =
    blocksPerRow * blockRowsPerStrip * decoder.bytesPerBlock;

  for (let y = 0; y < height; y += stripRows) {
    const rows = Math.min(stripRows, height - y);
    const blockRows = Math.ceil(rows / decoder.blockHeight);
    const stripIndex = y / stripRows;
    const input = raw!.subarray(
      stripIndex * stripBytes,
      stripIndex * stripBytes +
        blocksPerRow * blockRows * decoder.bytesPerBlock,
    );
    const decoded = decoder.decode(input, width, blockRows * decoder.blockHeight);
    const decodedRows = Math.min(decoded.length / rowBytes, stripRows);
    if (decodedRows < rows) {
      throw new Error(
        `条带解码输出不足：${decoded.length} 字节 < 需要 ${rows * rowBytes}`,
      );
    }
    copyStripRows(out, decoded, width, height, y, rows);
  }
  return { width, height, rgba: out };
}

/**
 * RGBA32：raw 本身就是未翻转的 RGBA，零解码，视图 + 就地翻转。
 * 与条带路径一样只依赖 source，不保留 Texture2D 引用。
 */
export function decodeAtlasRgba32Direct(
  source: AtlasTextureSource,
): AtlasPixels | null {
  if (source.alreadyDecoded || !source.raw) return null;
  if (source.format !== TextureFormat.RGBA32) return null;
  const { width, height } = source;
  const expected = width * height * 4;
  if (source.raw.length < expected) return null;
  const rgba = new Uint8ClampedArray(
    source.raw.buffer,
    source.raw.byteOffset,
    expected,
  );
  return {
    width,
    height,
    rgba: flipAtlasYInPlace(rgba, width, height),
  };
}

/** 仅凭捕获的 source 完成解码（条带或 RGBA32 直出）；PVRTC/ATC 等返回 null */
export function decodeAtlasFromSource(
  source: AtlasTextureSource,
): AtlasPixels | null {
  return decodeAtlasStrips(source) ?? decodeAtlasRgba32Direct(source);
}

/**
 * 整图回退：unity-js 懒解码 + 就地翻转。
 * 用于条带不支持的格式（PVRTC/ATC 等）或 `.data` 已被访问的场景。
 */
export function decodeAtlasWhole(texture: Texture2D): AtlasPixels {
  const tex = texture as unknown as {
    width: number;
    height: number;
    image: { data: Uint8Array };
  };
  const decoded = tex.image.data;
  const expected = tex.width * tex.height * 4;
  if (decoded.byteLength < expected) {
    throw new Error(
      `图集像素数据不足：${decoded.byteLength} < ${expected}（${tex.width}×${tex.height}）`,
    );
  }
  const rgba = new Uint8ClampedArray(
    decoded.buffer,
    decoded.byteOffset,
    expected,
  );
  return {
    width: tex.width,
    height: tex.height,
    rgba: flipAtlasYInPlace(rgba, tex.width, tex.height),
  };
}

/**
 * 解码图集：能从 source 解码则不触碰 Texture2D（条带 / RGBA32 直出），
 * 否则回退 unity-js 整图懒解码。各路径输出逐字节一致。
 */
export function decodeAtlasPixels(
  texture: Texture2D,
  source?: AtlasTextureSource,
): AtlasPixels {
  const captured = source ?? captureAtlasTextureSource(texture);
  const fromSource = decodeAtlasFromSource(captured);
  if (fromSource) return fromSource;
  return decodeAtlasWhole(texture);
}
