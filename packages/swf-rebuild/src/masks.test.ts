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

  it.each(
    [
      { mode: "Multiply", blend: 3, src: 2, grab: false },
      { mode: "Layer", blend: 2, src: 1, grab: false },
      { mode: "Darken", blend: 6, src: 1, grab: true },
      { mode: "Difference", blend: 7, src: 1, grab: true },
      { mode: "Invert", blend: 10, src: 1, grab: true },
    ].flatMap(({ mode, blend, src, grab }) =>
      [false, true].map((masked) => ({
        name: `Swf${masked ? "Masked" : "Simple"}${grab ? "Grab" : ""}Shader_${mode}${masked ? "_1" : ""}`,
        stencil: masked ? 1 : null,
        blend,
        src,
        grab,
      })),
    ),
  )(
    "exports $name with native blend mode $blend",
    ({ name, stencil, blend, src, grab }) => {
      const draw: Material = {
        name,
        floats: {
          _ExternalAlpha: 0,
          _SrcBlend: src,
          _DstBlend: 10,
          _BlendOp: 0,
          ...(stencil === null ? {} : { _StencilID: stencil }),
        },
      };
      const names =
        stencil === null
          ? [normal, name]
          : [normal, increment, name, decrement];
      const input = frame(names);
      input.subMeshes[names.indexOf(name)].material = draw;

      const result = framePlacements(input, dictionary(), 100, [0, 0]);
      expect(result.maskCount).toBe(stencil === null ? 0 : 1);
      const placement = result.tags.at(-1)!;
      expect(placement.code).toBe(70);
      expect(placement.data[1] & 0x02).toBe(0x02);
      expect(placement.data.at(-1)).toBe(blend);
      expect(result.tags[0].data.at(-1)).toBe(1);
      if (stencil !== null) {
        const mask = result.tags[1];
        expect(mask.code).toBe(26);
        expect(mask.data.readUInt16LE(mask.data.length - 2)).toBe(3);
      }

      for (const [property, value] of Object.entries({
        _ExternalAlpha: 1,
        _SrcBlend: src === 1 ? 2 : 1,
        _DstBlend: 1,
        _BlendOp: 2,
        _StencilID: 2,
      })) {
        expect(() =>
          resolveMaterial({
            ...draw,
            floats: { ...draw.floats, [property]: value },
          }),
        ).toThrow(`Unsupported material: ${name}`);
      }
      expect(() =>
        resolveMaterial({
          ...draw,
          name: grab
            ? name.replace("GrabShader", "Shader")
            : name.replace("Shader", "GrabShader"),
        }),
      ).toThrow("Unsupported material");
    },
  );
});
