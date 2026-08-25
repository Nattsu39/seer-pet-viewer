import type {
  ParsedSwfBundle,
  SwfFrameMesh,
  SwfSequence,
  SwfSubMesh,
} from "./types.js";
import type { AtlasPixels } from "./atlas.js";

/**
 * 解析 Worker 的请求模式：
 * full:   完整解析（帧 + 图集），首次导入用
 * frames: 仅重解析帧与材质，图集由主线程复用（needAtlas:false）
 * atlas:  仅解码图集位图，remount 恢复用
 */
export type ParserWorkerMode = "full" | "frames" | "atlas";

/** A range measured in elements of one of the packed typed-array buffers. */
export interface PackedArrayRange {
  offset: number;
  length: number;
}

/** A range measured in bytes of the independently transferred atlas buffer. */
export interface PackedByteRange {
  byteOffset: number;
  byteLength: number;
}

export interface PackedSwfFrameDescriptor {
  labels: string[];
  positions: PackedArrayRange;
  uvs: PackedArrayRange;
  addColors: PackedArrayRange;
  mulColors: PackedArrayRange;
  indices: PackedArrayRange;
  subMeshes: SwfSubMesh[];
}

export interface PackedSwfSequenceDescriptor {
  name: string;
  frames: PackedSwfFrameDescriptor[];
}

export interface PackedSwfBundleDescriptor {
  petId: number;
  name: string;
  frameRate: number;
  atlasWidth: number;
  atlasHeight: number;
  /** 仅当图集以 RGBA buffer 形式传输时存在；Worker 内已位图化时省略 */
  atlas?: PackedByteRange;
  materialWarnings: string[];
  sequences: PackedSwfSequenceDescriptor[];
}

export interface EncodedSwfBundleFrames {
  descriptor: PackedSwfBundleDescriptor;
  floatBuffer: ArrayBuffer;
  uintBuffer: ArrayBuffer;
}

export interface EncodedParsedSwfBundle extends EncodedSwfBundleFrames {
  atlasBuffer: ArrayBuffer;
}

/** 帧数据以外的元信息（图集单独传输） */
export interface DecodedSwfBundleFrames {
  petId: number;
  name: string;
  frameRate: number;
  atlasWidth: number;
  atlasHeight: number;
  materialWarnings: string[];
  sequences: SwfSequence[];
}

function cloneSubMeshes(subMeshes: SwfSubMesh[]): SwfSubMesh[] {
  return subMeshes.map((subMesh) => ({
    ...subMesh,
    material: { ...subMesh.material },
  }));
}

function copyFloatArray(
  target: Float32Array,
  offset: number,
  source: Float32Array,
): PackedArrayRange {
  target.set(source, offset);
  return { offset, length: source.length };
}

function copyUintArray(
  target: Uint16Array,
  offset: number,
  source: Uint16Array,
): PackedArrayRange {
  target.set(source, offset);
  return { offset, length: source.length };
}

function getFloatLength(sequences: SwfSequence[]): number {
  let length = 0;
  for (const sequence of sequences) {
    for (const frame of sequence.frames) {
      const mesh = frame.mesh;
      length +=
        mesh.positions.length +
        mesh.uvs.length +
        mesh.addColors.length +
        mesh.mulColors.length;
    }
  }
  return length;
}

function getUintLength(sequences: SwfSequence[]): number {
  let length = 0;
  for (const sequence of sequences) {
    for (const frame of sequence.frames) length += frame.mesh.indices.length;
  }
  return length;
}

function encodeFrame(
  mesh: SwfFrameMesh,
  floats: Float32Array,
  floatOffset: { value: number },
  uints: Uint16Array,
  uintOffset: { value: number },
  labels: string[],
  subMeshes: SwfSubMesh[],
): PackedSwfFrameDescriptor {
  const positions = copyFloatArray(floats, floatOffset.value, mesh.positions);
  floatOffset.value += mesh.positions.length;
  const uvs = copyFloatArray(floats, floatOffset.value, mesh.uvs);
  floatOffset.value += mesh.uvs.length;
  const addColors = copyFloatArray(
    floats,
    floatOffset.value,
    mesh.addColors,
  );
  floatOffset.value += mesh.addColors.length;
  const mulColors = copyFloatArray(
    floats,
    floatOffset.value,
    mesh.mulColors,
  );
  floatOffset.value += mesh.mulColors.length;
  const indices = copyUintArray(uints, uintOffset.value, mesh.indices);
  uintOffset.value += mesh.indices.length;

  return {
    labels,
    positions,
    uvs,
    addColors,
    mulColors,
    indices,
    subMeshes,
  };
}

/**
 * Pack all frame vertex data into exactly two contiguous transfer buffers.
 * The atlas is not part of them: it either travels as its own buffer
 * (`encodeParsedSwfBundle`) or as an ImageBitmap built inside the worker.
 */
export function encodeSwfBundleFrames(
  data: ParsedSwfBundle,
): EncodedSwfBundleFrames {
  const floats = new Float32Array(getFloatLength(data.sequences));
  const uints = new Uint16Array(getUintLength(data.sequences));
  const floatOffset = { value: 0 };
  const uintOffset = { value: 0 };
  const sequences: PackedSwfSequenceDescriptor[] = [];

  for (const sequence of data.sequences) {
    const frames: PackedSwfFrameDescriptor[] = [];
    for (const frame of sequence.frames) {
      frames.push(
        encodeFrame(
          frame.mesh,
          floats,
          floatOffset,
          uints,
          uintOffset,
          frame.labels.map((label) => label),
          cloneSubMeshes(frame.mesh.subMeshes),
        ),
      );
    }
    sequences.push({ name: sequence.name, frames });
  }

  return {
    descriptor: {
      petId: data.petId,
      name: data.name,
      frameRate: data.frameRate,
      atlasWidth: data.atlasWidth,
      atlasHeight: data.atlasHeight,
      materialWarnings: data.materialWarnings.map((warning) => warning),
      sequences,
    },
    floatBuffer: floats.buffer,
    uintBuffer: uints.buffer,
  };
}

/**
 * 帧数据 + 图集 RGBA buffer。图集获得独立 buffer，
 * 因此三个 transferable 的所有权边界互不重叠。
 * 已经是独占 buffer 的图集视图直接交出所有权，不再复制整图。
 */
export function encodeParsedSwfBundle(
  data: ParsedSwfBundle,
): EncodedParsedSwfBundle {
  if (!data.atlasPixels) {
    throw new Error("encodeParsedSwfBundle 需要 atlasPixels");
  }
  const frames = encodeSwfBundleFrames(data);
  const rgba = data.atlasPixels.rgba;
  const atlasBuffer =
    rgba.buffer instanceof ArrayBuffer &&
    rgba.byteOffset === 0 &&
    rgba.byteLength === rgba.buffer.byteLength
      ? rgba.buffer
      : (() => {
          const copy = new ArrayBuffer(rgba.byteLength);
          new Uint8Array(copy).set(rgba);
          return copy;
        })();

  return {
    ...frames,
    descriptor: {
      ...frames.descriptor,
      atlas: { byteOffset: 0, byteLength: rgba.byteLength },
    },
    atlasBuffer,
  };
}

function assertRange(
  range: PackedArrayRange,
  elementSize: number,
  byteLength: number,
  label: string,
): void {
  if (
    !Number.isSafeInteger(range.offset) ||
    !Number.isSafeInteger(range.length) ||
    range.offset < 0 ||
    range.length < 0
  ) {
    throw new Error(`无效的 ${label} buffer 范围`);
  }
  const byteOffset = range.offset * elementSize;
  const rangeByteLength = range.length * elementSize;
  if (
    !Number.isSafeInteger(byteOffset) ||
    !Number.isSafeInteger(rangeByteLength) ||
    byteOffset + rangeByteLength > byteLength
  ) {
    throw new Error(`越界的 ${label} buffer 范围`);
  }
}

function assertByteRange(
  range: PackedByteRange,
  byteLength: number,
): void {
  if (
    !Number.isSafeInteger(range.byteOffset) ||
    !Number.isSafeInteger(range.byteLength) ||
    range.byteOffset < 0 ||
    range.byteLength < 0 ||
    range.byteOffset + range.byteLength > byteLength
  ) {
    throw new Error("越界的 atlas buffer 范围");
  }
}

function decodeFrame(
  descriptor: PackedSwfFrameDescriptor,
  floats: Float32Array,
  uints: Uint16Array,
): {
  labels: string[];
  mesh: SwfFrameMesh;
} {
  assertRange(descriptor.positions, Float32Array.BYTES_PER_ELEMENT, floats.byteLength, "positions");
  assertRange(descriptor.uvs, Float32Array.BYTES_PER_ELEMENT, floats.byteLength, "uvs");
  assertRange(descriptor.addColors, Float32Array.BYTES_PER_ELEMENT, floats.byteLength, "addColors");
  assertRange(descriptor.mulColors, Float32Array.BYTES_PER_ELEMENT, floats.byteLength, "mulColors");
  assertRange(descriptor.indices, Uint16Array.BYTES_PER_ELEMENT, uints.byteLength, "indices");

  return {
    labels: descriptor.labels,
    mesh: {
      positions: new Float32Array(
        floats.buffer,
        descriptor.positions.offset * Float32Array.BYTES_PER_ELEMENT,
        descriptor.positions.length,
      ),
      uvs: new Float32Array(
        floats.buffer,
        descriptor.uvs.offset * Float32Array.BYTES_PER_ELEMENT,
        descriptor.uvs.length,
      ),
      addColors: new Float32Array(
        floats.buffer,
        descriptor.addColors.offset * Float32Array.BYTES_PER_ELEMENT,
        descriptor.addColors.length,
      ),
      mulColors: new Float32Array(
        floats.buffer,
        descriptor.mulColors.offset * Float32Array.BYTES_PER_ELEMENT,
        descriptor.mulColors.length,
      ),
      indices: new Uint16Array(
        uints.buffer,
        descriptor.indices.offset * Uint16Array.BYTES_PER_ELEMENT,
        descriptor.indices.length,
      ),
      subMeshes: descriptor.subMeshes,
    },
  };
}

/**
 * Rehydrate frame data using views over the transferred buffers.
 * No frame typed-array data is copied during decoding.
 */
export function decodeSwfBundleFrames(
  descriptor: PackedSwfBundleDescriptor,
  floatBuffer: ArrayBuffer,
  uintBuffer: ArrayBuffer,
): DecodedSwfBundleFrames {
  const floats = new Float32Array(floatBuffer);
  const uints = new Uint16Array(uintBuffer);

  return {
    petId: descriptor.petId,
    name: descriptor.name,
    frameRate: descriptor.frameRate,
    atlasWidth: descriptor.atlasWidth,
    atlasHeight: descriptor.atlasHeight,
    materialWarnings: descriptor.materialWarnings,
    sequences: descriptor.sequences.map((sequence) => ({
      name: sequence.name,
      frames: sequence.frames.map((frame) => decodeFrame(frame, floats, uints)),
    })),
  };
}

/** 图集以 RGBA buffer 传输时，按 descriptor 范围建立零拷贝视图 */
export function decodeAtlasPixels(
  descriptor: PackedSwfBundleDescriptor,
  atlasBuffer: ArrayBuffer,
): AtlasPixels {
  if (!descriptor.atlas) {
    throw new Error("descriptor 缺少 atlas 范围");
  }
  assertByteRange(descriptor.atlas, atlasBuffer.byteLength);
  return {
    width: descriptor.atlasWidth,
    height: descriptor.atlasHeight,
    rgba: new Uint8ClampedArray(
      atlasBuffer,
      descriptor.atlas.byteOffset,
      descriptor.atlas.byteLength,
    ),
  };
}

export function decodeParsedSwfBundle(
  descriptor: PackedSwfBundleDescriptor,
  floatBuffer: ArrayBuffer,
  uintBuffer: ArrayBuffer,
  atlasBuffer: ArrayBuffer,
): ParsedSwfBundle {
  const atlasPixels = decodeAtlasPixels(descriptor, atlasBuffer);
  return {
    ...decodeSwfBundleFrames(descriptor, floatBuffer, uintBuffer),
    atlasPixels,
  };
}
