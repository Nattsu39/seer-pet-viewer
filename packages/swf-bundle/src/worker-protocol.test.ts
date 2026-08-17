import { describe, expect, it } from "vitest";
import type { ParsedSwfBundle, SwfMaterialState } from "./types.js";
import {
  decodeParsedSwfBundle,
  encodeParsedSwfBundle,
  type PackedSwfBundleDescriptor,
} from "./worker-protocol.js";

const material: SwfMaterialState = {
  blendMode: "normal",
  shaderKind: "simple",
  srcBlend: 1,
  dstBlend: 0,
  blendOp: 0,
  stencilId: 0,
};

function makeBundle(): ParsedSwfBundle {
  return {
    petId: 4911,
    name: "ppets_4911",
    frameRate: 30,
    atlasWidth: 3,
    atlasHeight: 2,
    atlasPixels: {
      width: 3,
      height: 2,
      rgba: new Uint8ClampedArray([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
        20, 21, 22, 23, 24,
      ]),
    },
    materialWarnings: ["warning"],
    sequences: [
      {
        name: "standby",
        frames: [
          {
            labels: ["start"],
            mesh: {
              positions: new Float32Array([1, 2, 3]),
              uvs: new Float32Array([0.1, 0.2]),
              addColors: new Float32Array([1, 0, 0, 1]),
              mulColors: new Float32Array([1, 1, 1, 1]),
              indices: new Uint16Array([0, 1, 2]),
              subMeshes: [
                {
                  startVertex: 0,
                  indexCount: 3,
                  indexStart: 0,
                  material,
                  materialPathId: "42",
                },
              ],
            },
          },
          {
            labels: [],
            mesh: {
              positions: new Float32Array([]),
              uvs: new Float32Array([]),
              addColors: new Float32Array([]),
              mulColors: new Float32Array([]),
              indices: new Uint16Array([]),
              subMeshes: [],
            },
          },
        ],
      },
      {
        name: "attack",
        frames: [
          {
            labels: ["hit", "end"],
            mesh: {
              positions: new Float32Array([-1, -2]),
              uvs: new Float32Array([0.9, 0.8]),
              addColors: new Float32Array([0, 1]),
              mulColors: new Float32Array([0.5, 0.75]),
              indices: new Uint16Array([2, 1]),
              subMeshes: [],
            },
          },
        ],
      },
    ],
  };
}

describe("SWF worker binary protocol", () => {
  it("round-trips multiple sequences, frames, and empty arrays", () => {
    const source = makeBundle();
    const encoded = encodeParsedSwfBundle(source);
    const decoded = decodeParsedSwfBundle(
      encoded.descriptor,
      encoded.floatBuffer,
      encoded.uintBuffer,
      encoded.atlasBuffer,
    );

    expect(decoded.petId).toBe(source.petId);
    expect(decoded.name).toBe(source.name);
    expect(decoded.frameRate).toBe(source.frameRate);
    expect(decoded.sequences).toHaveLength(2);
    expect(decoded.sequences[0]!.frames).toHaveLength(2);
    expect(Array.from(decoded.sequences[0]!.frames[0]!.mesh.positions)).toEqual(
      Array.from(source.sequences[0]!.frames[0]!.mesh.positions),
    );
    expect(decoded.sequences[0]!.frames[1]!.mesh.positions).toHaveLength(0);
    expect(Array.from(decoded.sequences[1]!.frames[0]!.mesh.indices)).toEqual([
      2, 1,
    ]);
    expect(Array.from(decoded.atlasPixels.rgba)).toEqual(
      Array.from(source.atlasPixels.rgba),
    );
  });

  it("uses shared backing buffers for every decoded typed array", () => {
    const encoded = encodeParsedSwfBundle(makeBundle());
    const decoded = decodeParsedSwfBundle(
      encoded.descriptor,
      encoded.floatBuffer,
      encoded.uintBuffer,
      encoded.atlasBuffer,
    );
    const first = decoded.sequences[0]!.frames[0]!.mesh;

    expect(first.positions.buffer).toBe(encoded.floatBuffer);
    expect(first.uvs.buffer).toBe(encoded.floatBuffer);
    expect(first.addColors.buffer).toBe(encoded.floatBuffer);
    expect(first.mulColors.buffer).toBe(encoded.floatBuffer);
    expect(first.indices.buffer).toBe(encoded.uintBuffer);
    expect(decoded.atlasPixels.rgba.buffer).toBe(encoded.atlasBuffer);
  });

  it("has no frame number arrays in the descriptor and transfers three buffers", () => {
    const encoded = encodeParsedSwfBundle(makeBundle());
    const descriptor = encoded.descriptor as PackedSwfBundleDescriptor;
    const json = JSON.stringify(descriptor);

    expect(json).not.toContain("positions\":[");
    expect(json).not.toContain("indices\":[");
    expect(Object.keys(encoded)).toEqual([
      "descriptor",
      "floatBuffer",
      "uintBuffer",
      "atlasBuffer",
    ]);
    expect([encoded.floatBuffer, encoded.uintBuffer, encoded.atlasBuffer]).toHaveLength(3);
  });

  it("keeps descriptor atlas byte offset and byte length explicit", () => {
    const encoded = encodeParsedSwfBundle(makeBundle());

    expect(encoded.descriptor.atlas).toEqual({ byteOffset: 0, byteLength: 24 });
  });

  it("reuses a complete atlas ArrayBuffer view without copying", () => {
    const source = makeBundle();
    const backing = new ArrayBuffer(source.atlasPixels.rgba.byteLength);
    const rgba = new Uint8ClampedArray(backing);
    rgba.set(source.atlasPixels.rgba);
    source.atlasPixels.rgba = rgba;

    const encoded = encodeParsedSwfBundle(source);

    expect(encoded.atlasBuffer).toBe(backing);
    expect(encoded.descriptor.atlas).toEqual({
      byteOffset: 0,
      byteLength: backing.byteLength,
    });
  });

  it("copies a sliced atlas view into an exact independent range", () => {
    const source = makeBundle();
    const backing = new Uint8Array([99, 98, 1, 2, 3, 4, 97]);
    source.atlasPixels.rgba = new Uint8ClampedArray(
      backing.buffer,
      2,
      4,
    );

    const encoded = encodeParsedSwfBundle(source);
    const decoded = decodeParsedSwfBundle(
      encoded.descriptor,
      encoded.floatBuffer,
      encoded.uintBuffer,
      encoded.atlasBuffer,
    );

    expect(encoded.atlasBuffer).not.toBe(backing.buffer);
    expect(encoded.atlasBuffer.byteLength).toBe(4);
    expect(encoded.descriptor.atlas).toEqual({
      byteOffset: 0,
      byteLength: 4,
    });
    expect(Array.from(decoded.atlasPixels.rgba)).toEqual([1, 2, 3, 4]);
  });

  it("survives structured-clone transfer detaching the encoded buffers", () => {
    const encoded = encodeParsedSwfBundle(makeBundle());
    const clone = structuredClone(encoded, {
      transfer: [encoded.floatBuffer, encoded.uintBuffer, encoded.atlasBuffer],
    });
    const decoded = decodeParsedSwfBundle(
      clone.descriptor,
      clone.floatBuffer,
      clone.uintBuffer,
      clone.atlasBuffer,
    );

    expect(encoded.floatBuffer.byteLength).toBe(0);
    expect(encoded.uintBuffer.byteLength).toBe(0);
    expect(encoded.atlasBuffer.byteLength).toBe(0);
    expect(decoded.sequences[0]!.frames[0]!.mesh.positions[0]).toBe(1);
    expect(decoded.atlasPixels.rgba[0]).toBe(1);
  });
});
