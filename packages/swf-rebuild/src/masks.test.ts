import { describe, expect, it } from "vitest";
import { framePlacements } from "./frames.js";
import { resolveMaterial } from "./material.js";
import { alphaRectangles, ResourceDictionary } from "./resources.js";
import { readTags } from "./swf.js";
import type { Frame, Material } from "./types.js";

function material(name: string): Material {
  if (name.includes("Incr") || name.includes("Decr"))
    return { name, floats: { _ExternalAlpha: 0 } };
  const stencilMatch = /_(\d+)$/.exec(name);
  const base = stencilMatch ? name.slice(0, -stencilMatch[0].length) : name;
  return {
    name,
    floats: {
      _ExternalAlpha: 0,
      _BlendOp: base.endsWith("Subtract") ? 2 : 0,
      _SrcBlend: base.endsWith("Screen") ? 4 : 1,
      _DstBlend: base.includes("Normal") ? 10 : 1,
      ...(name.includes("Masked")
        ? { _StencilID: stencilMatch ? Number(stencilMatch[1]) : 1 }
        : {}),
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

function shiftQuad(input: Frame, quadIndex: number, dx: number): void {
  for (let i = 0; i < 4; i++) input.vertices[quadIndex * 4 + i].x += dx;
}

const normal = "SwfSimpleShader_Normal";
const increment = "SwfIncrMaskShader";
const decrement = "SwfDecrMaskShader";
const masked = "SwfMaskedShader_Normal_1";
const masked2 = "SwfMaskedShader_Normal_2";
const masked3 = "SwfMaskedShader_Normal_3";
const maskedAdd = "SwfMaskedShader_Add_1";
const maskedAdd2 = "SwfMaskedShader_Add_2";
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
      [increment, masked2, decrement],
      [increment, increment, masked, decrement, decrement],
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
    expect(() =>
      resolveMaterial(material("SwfMaskedShader_Normal_0")),
    ).toThrow("Unsupported");
    expect(() =>
      resolveMaterial(material("SwfMaskedShader_Normal_256")),
    ).toThrow("Unsupported");
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

  it("wraps nested stencil masks in single-frame sprites defined after their shapes", () => {
    const resources = dictionary();
    const input = frame([
      normal,
      increment,
      masked,
      increment,
      masked2,
      maskedAdd2,
      decrement,
      masked,
      decrement,
      normal,
    ]);
    // 区分外层和内层遮罩几何，确保按各自几何精确匹配。
    shiftQuad(input, 3, 0.2);
    shiftQuad(input, 6, 0.2);

    const result = framePlacements(input, resources, 100, [0, 0]);
    expect(result.maskCount).toBe(2);
    // depth: 1 normal, 2 outer mask (clip 5), 3 masked, 4 inner sprite, 5 masked, 6 normal
    expect(result.tags.map((tag) => tag.code)).toEqual([
      70, 26, 70, 26, 70, 70,
    ]);
    const outerMask = result.tags[1].data;
    expect(outerMask[0]).toBe(0x46);
    expect(outerMask.readUInt16LE(1)).toBe(2);
    expect(outerMask.readUInt16LE(outerMask.length - 2)).toBe(5);

    const spritePlacement = result.tags[3].data;
    expect(spritePlacement[0]).toBe(0x02);
    expect(spritePlacement.readUInt16LE(1)).toBe(4);
    const spriteId = spritePlacement.readUInt16LE(3);
    expect(result.tags[5].data.readUInt16LE(2)).toBe(6);

    const spriteTag = resources.tags.find(
      (tag) => tag.code === 39 && tag.data.readUInt16LE(0) === spriteId,
    );
    expect(spriteTag).toBeDefined();
    expect(spriteTag!.data.readUInt16LE(2)).toBe(1);
    const innerTags = readTags(spriteTag!.data.subarray(4));
    expect(innerTags.map((tag) => tag.code)).toEqual([26, 70, 70, 1, 0]);
    expect(innerTags[0].data[0]).toBe(0x46);
    expect(innerTags[0].data.readUInt16LE(1)).toBe(1);
    expect(innerTags[0].data.readUInt16LE(innerTags[0].data.length - 2)).toBe(
      3,
    );
    expect(innerTags[1].data.readUInt16LE(2)).toBe(2);
    expect(innerTags[2].data.readUInt16LE(2)).toBe(3);
    expect(innerTags[2].data.at(-1)).toBe(8);

    // 确认内层 DefineSprite 位于其引用的所有形状定义之后。
    const spriteIndex = resources.tags.indexOf(spriteTag!);
    const innerMaskCharId = innerTags[0].data.readUInt16LE(3);
    const innerDrawCharId = innerTags[1].data.readUInt16LE(4);
    for (const refId of [innerMaskCharId, innerDrawCharId]) {
      const defIndex = resources.tags.findIndex(
        (tag) => tag.code === 32 && tag.data.readUInt16LE(0) === refId,
      );
      expect(defIndex).toBeGreaterThanOrEqual(0);
      expect(defIndex).toBeLessThan(spriteIndex);
    }
  });

  it("supports multi-level nesting and drops empty nested masks without allocating sprites", () => {
    const resources = dictionary();
    const deep = frame([
      increment,
      increment,
      increment,
      masked3,
      decrement,
      decrement,
      decrement,
    ]);
    const deepResult = framePlacements(deep, resources, 100, [0, 0]);
    expect(deepResult.maskCount).toBe(3);
    expect(deepResult.tags.map((tag) => tag.code)).toEqual([26, 26]);
    const sprites = resources.tags.filter((tag) => tag.code === 39);
    expect(sprites).toHaveLength(2);
    const outerSpriteId = deepResult.tags[1].data.readUInt16LE(3);
    const innerSpriteId = readTags(sprites[1].data.subarray(4))[1].data.readUInt16LE(3);
    expect(sprites[1].data.readUInt16LE(0)).toBe(outerSpriteId);
    expect(sprites[0].data.readUInt16LE(0)).toBe(innerSpriteId);

    const emptyResources = dictionary();
    const emptyNested = frame([
      increment,
      masked,
      increment,
      decrement,
      masked,
      decrement,
    ]);
    const emptyResult = framePlacements(emptyNested, emptyResources, 100, [0, 0]);
    expect(emptyResult.maskCount).toBe(1);
    expect(emptyResult.tags.map((tag) => tag.code)).toEqual([26, 70, 70]);
    expect(emptyResources.tags.filter((tag) => tag.code === 39)).toHaveLength(0);

    const allEmptyResources = dictionary();
    const allEmpty = frame([increment, increment, decrement, decrement]);
    const allEmptyResult = framePlacements(allEmpty, allEmptyResources, 100, [0, 0]);
    expect(allEmptyResult.maskCount).toBe(0);
    expect(allEmptyResult.tags).toEqual([]);
    expect(allEmptyResources.tags.filter((tag) => tag.code === 39)).toHaveLength(0);
  });

  it("supports FIFO and overlapping stencil decrements by splitting active mask scopes", () => {
    // FIFO 闭合：M1、M2 同时开启，先关 M1 再关 M2（无中间绘制）
    const fifoResources = dictionary();
    const fifo = frame([increment, increment, masked2, decrement, decrement]);
    shiftQuad(fifo, 1, 0.25);
    shiftQuad(fifo, 4, 0.25);
    const fifoResult = framePlacements(fifo, fifoResources, 100, [0, 0]);
    expect(fifoResult.maskCount).toBe(2);
    expect(fifoResult.tags.map((tag) => tag.code)).toEqual([26, 26]);
    expect(fifoResult.tags[0].data.readUInt16LE(1)).toBe(1);
    expect(
      fifoResult.tags[0].data.readUInt16LE(fifoResult.tags[0].data.length - 2),
    ).toBe(2);
    expect(fifoResult.tags[1].data[0]).toBe(0x02);

    // 真重叠：M1 开启 -> draw1 -> M2 开启 -> draw2 -> M1 关闭 -> draw3 -> M2 关闭
    const overlapResources = dictionary();
    const overlap = frame([
      increment,
      masked,
      increment,
      masked2,
      decrement,
      masked,
      decrement,
    ]);
    shiftQuad(overlap, 2, 0.5);
    shiftQuad(overlap, 6, 0.5);
    const overlapResult = framePlacements(overlap, overlapResources, 100, [0, 0]);
    expect(overlapResult.maskCount).toBe(3);
    // 1: mask M1 (clip 3), 2: draw1, 3: sprite(M2 + draw2), 4: mask M2 (clip 5), 5: draw3
    expect(overlapResult.tags.map((tag) => tag.code)).toEqual([
      26, 70, 26, 26, 70,
    ]);
    expect(overlapResult.tags[0].data.readUInt16LE(1)).toBe(1);
    expect(
      overlapResult.tags[0].data.readUInt16LE(
        overlapResult.tags[0].data.length - 2,
      ),
    ).toBe(3);
    expect(overlapResult.tags[2].data[0]).toBe(0x02);
    expect(overlapResult.tags[3].data[0]).toBe(0x46);
    expect(overlapResult.tags[3].data.readUInt16LE(1)).toBe(4);
    expect(
      overlapResult.tags[3].data.readUInt16LE(
        overlapResult.tags[3].data.length - 2,
      ),
    ).toBe(5);
    expect(overlapResult.tags[4].data.readUInt16LE(2)).toBe(5);
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
