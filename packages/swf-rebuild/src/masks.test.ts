import { describe, expect, it } from "vitest";
import { framePlacements } from "./frames.js";
import { resolveMaterial } from "./material.js";
import { alphaRectangles, ResourceDictionary } from "./resources.js";
import type { Frame, Material } from "./types.js";

function material(name: string): Material {
  if (name.includes("Incr") || name.includes("Decr"))
    return { name, floats: { _ExternalAlpha: 0 } };
  return {
    name,
    floats: {
      _ExternalAlpha: 0,
      _BlendOp: name.endsWith("Subtract") ? 2 : 0,
      _SrcBlend: name.endsWith("Screen") ? 4 : 1,
      _DstBlend: name.includes("Normal") ? 10 : 1,
      ...(name.includes("Masked") ? { _StencilID: 1 } : {}),
    },
  };
}

function frame(names: string[]): Frame {
  return {
    labels: [],
    vertices: names.flatMap(() => [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: -1 },
      { x: 0, y: -1 },
    ]),
    uvs: names.flatMap(() => [0, 0xffffffff]),
    mulColors: names.flatMap(() => [0x02000200, 0x02000200]),
    addColors: names.flatMap(() => [0, 0]),
    subMeshes: names.map((name, index) => ({
      startVertex: index * 4,
      indexCount: 6,
      material: material(name),
    })),
  };
}

const normal = "SwfSimpleShader_Normal";
const increment = "SwfIncrMaskShader";
const decrement = "SwfDecrMaskShader";
const masked = "SwfMaskedShader_Normal_1";
const maskedAdd = "SwfMaskedShader_Add_1";
const dictionary = (): ResourceDictionary =>
  new ResourceDictionary(
    { width: 3, height: 3, rgba: Buffer.alloc(36, 255) },
    100,
  );

describe("native Flash mask conversion", () => {
  it("preserves threshold boundaries and holes while merging adjacent row runs", () => {
    const alpha = [0, 3, 255, 0, 2, 128, 128, 2, 3, 0, 0, 255, 3, 0, 0, 255];
    const rgba = Uint8Array.from(
      alpha.flatMap((value) => [255, 255, 255, value]),
    );
    const rectangles = alphaRectangles(4, 4, rgba);
    expect(rectangles).toEqual([
      { x: 1, y: 0, width: 2, height: 2 },
      { x: 0, y: 2, width: 1, height: 2 },
      { x: 3, y: 2, width: 1, height: 2 },
    ]);
    const coverage = new Array(16).fill(0);
    for (const r of rectangles)
      for (let y = r.y; y < r.y + r.height; y++) {
        for (let x = r.x; x < r.x + r.width; x++) coverage[y * 4 + x]++;
      }
    expect(coverage).toEqual(alpha.map((value) => Number(value >= 3)));
    expect(alphaRectangles(2, 2, Buffer.alloc(16))).toEqual([]);
  });

  it("clips exactly the intervening normal/add draws and removes stencil writes from visible content", () => {
    const resources = dictionary();
    const result = framePlacements(
      frame([normal, increment, masked, maskedAdd, decrement, normal]),
      resources,
      100,
      [0, 0],
    );
    expect(result.maskCount).toBe(1);
    expect(result.tags.map((tag) => tag.code)).toEqual([70, 26, 70, 70, 70]);
    const mask = result.tags[1].data;
    expect(mask[0]).toBe(0x46);
    expect(mask.readUInt16LE(1)).toBe(2);
    expect(mask.readUInt16LE(mask.length - 2)).toBe(4);
    expect(result.tags[3].data.at(-1)).toBe(8);
    expect(result.tags[4].data.readUInt16LE(2)).toBe(5);
    expect(resources.masks.size).toBe(1);
    expect(resources.regions.size).toBe(1);
  });

  it("rejects malformed stencil intervals instead of producing unmasked effects", () => {
    for (const names of [
      [masked],
      [decrement],
      [increment, masked],
      [increment, increment],
      [increment, normal, decrement],
    ]) {
      expect(() =>
        framePlacements(frame(names), dictionary(), 100, [0, 0]),
      ).toThrow();
    }
    const mismatched = frame([increment, masked, decrement]);
    mismatched.vertices[8].x = 0.1;
    expect(() =>
      framePlacements(mismatched, dictionary(), 100, [0, 0]),
    ).toThrow("Unmatched");
  });

  it("drops an empty balanced mask interval without clipping the following object", () => {
    const result = framePlacements(
      frame([normal, increment, decrement, normal]),
      dictionary(),
      100,
      [0, 0],
    );
    expect(result.maskCount).toBe(0);
    expect(result.tags.map((tag) => tag.code)).toEqual([70, 70]);
    expect(result.tags[1].data.readUInt16LE(2)).toBe(2);
  });

  it("maps Screen and reverse Subtract and verifies their Unity render states", () => {
    expect(resolveMaterial(material("SwfSimpleShader_Screen"))).toEqual({
      kind: "draw",
      blend: 4,
      stencil: null,
    });
    expect(resolveMaterial(material("SwfSimpleShader_Subtract"))).toEqual({
      kind: "draw",
      blend: 9,
      stencil: null,
    });
    const incorrect = material("SwfSimpleShader_Subtract");
    incorrect.floats._BlendOp = 0;
    expect(() => resolveMaterial(incorrect)).toThrow("Unsupported");
  });
});
