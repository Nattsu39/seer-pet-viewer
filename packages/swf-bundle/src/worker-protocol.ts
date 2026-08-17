import type {
  ParsedSwfBundle,
  SwfFrameMesh,
  SwfSequence,
  SwfSubMesh,
} from "./types.js";

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
  atlas: PackedByteRange;
  materialWarnings: string[];
  sequences: PackedSwfSequenceDescriptor[];
}

export interface EncodedParsedSwfBundle {
  descriptor: PackedSwfBundleDescriptor;
  floatBuffer: ArrayBuffer;
  uintBuffer: ArrayBuffer;
  atlasBuffer: ArrayBuffer;
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
 * The atlas gets its own buffer so that the three response transferables have
 * stable, independent ownership boundaries.
 */
export function encodeParsedSwfBundle(
  data: ParsedSwfBundle,
): EncodedParsedSwfBundle {
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
    descriptor: {
      petId: data.petId,
      name: data.name,
      frameRate: data.frameRate,
      atlasWidth: data.atlasWidth,
      atlasHeight: data.atlasHeight,
      atlas: { byteOffset: 0, byteLength: rgba.byteLength },
      materialWarnings: data.materialWarnings.map((warning) => warning),
      sequences,
    },
    floatBuffer: floats.buffer,
    uintBuffer: uints.buffer,
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
 * Rehydrate a packed response using views over the transferred buffers.
 * No frame typed-array data is copied during decoding.
 */
export function decodeParsedSwfBundle(
  descriptor: PackedSwfBundleDescriptor,
  floatBuffer: ArrayBuffer,
  uintBuffer: ArrayBuffer,
  atlasBuffer: ArrayBuffer,
): ParsedSwfBundle {
  const floats = new Float32Array(floatBuffer);
  const uints = new Uint16Array(uintBuffer);
  assertByteRange(descriptor.atlas, atlasBuffer.byteLength);

  return {
    petId: descriptor.petId,
    name: descriptor.name,
    frameRate: descriptor.frameRate,
    atlasWidth: descriptor.atlasWidth,
    atlasHeight: descriptor.atlasHeight,
    atlasPixels: {
      width: descriptor.atlasWidth,
      height: descriptor.atlasHeight,
      rgba: new Uint8ClampedArray(
        atlasBuffer,
        descriptor.atlas.byteOffset,
        descriptor.atlas.byteLength,
      ),
    },
    materialWarnings: descriptor.materialWarnings,
    sequences: descriptor.sequences.map((sequence) => ({
      name: sequence.name,
      frames: sequence.frames.map((frame) =>
        decodeFrame(frame, floats, uints),
      ),
    })),
  };
}
