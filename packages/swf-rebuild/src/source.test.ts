import { describe, expect, it } from "vitest";
import { stubFixture } from "./abc-fixture.js";
import { cstring, u16, u32 } from "./binary.js";
import { rebuildPet } from "./rebuild.js";
import { discoverSource } from "./source.js";
import { bitmap, end, label, matrix, readSwf, readTags, rect, remove, showFrame, sprite, writeSwf,
  type Matrix, type SwfFile, type Tag } from "./swf.js";
import type { Clip, Frame } from "./types.js";

function placement(id: number, transform: Matrix = [1, 0, 0, 1, 0, 0], depth = 1): Tag {
  return { code: 26, data: Buffer.concat([Buffer.from([6]), u16(depth), u16(id), matrix(transform)]) };
}

// 刻意使用互不相关的 ID、尺寸、帧率、类名和动作名。
// 宠物不是字典中的最大 ID，动作标签也出现在移动指令之后。
function fixture(): { file: SwfFile; clip: Clip } {
  const idle = (): Tag => placement(12, [1, 0, 0, 1, -17, 23]);
  const frame = (labels: string[]): Frame => ({
    labels,
    vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: -1 }, { x: 0, y: -1 }],
    uvs: [0, 0xffffffff], addColors: [0, 0], mulColors: [0x02000200, 0x02000200],
    subMeshes: [{ startVertex: 0, indexCount: 6, material: {
      name: "SwfSimpleShader_Normal", floats: { _ExternalAlpha: 0, _BlendOp: 0, _SrcBlend: 1, _DstBlend: 10 },
    } }],
  });
  const file: SwfFile = { version: 15,
    header: Buffer.concat([rect([0, 2000, 0, 2000]), u16(30 * 256), u16(1)]),
    tags: [
      sprite(12, [[]]), sprite(15, [[]]),
      sprite(21, [[idle()], [remove(1), placement(15)], [remove(1), idle()]]),
      sprite(8, [[placement(21)], [
        { code: 26, data: Buffer.concat([Buffer.from([5]), u16(1), matrix([1, 0, 0, 1, -123, -456])]) },
        label("special"),
      ]]),
      bitmap(90, 1, 1, Buffer.alloc(4, 255)),
      { code: 76, data: Buffer.concat([u16(2), u16(8), cstring("pet"), u16(21), cstring("Example")]) },
      { code: 82, data: Buffer.concat([u32(0), cstring(""), stubFixture().abc]) },
      showFrame(), end(),
    ],
  };
  const clip: Clip = { frameRate: 30, pixelsPerUnit: 40,
    atlas: { width: 2, height: 2, rgba: Buffer.alloc(16, 255) },
    sequences: [
      { name: "standby", frames: [frame([]), frame(["action_end"])] },
      { name: "special", frames: [frame([]), frame([]), frame(["action_hit"]), frame(["action_end"])] },
    ],
  };
  return { file, clip };
}

describe("structural source discovery", () => {
  it("keeps the appear wrapper stopped on frame 2 while its child plays the complete sequence", () => {
    const { file, clip } = fixture();
    clip.sequences[1].name = "appear";
    file.tags[3] = sprite(8, [[label("appear"), placement(21, [1, 0, 0, 1, -123, -456])]]);
    // 故意设置非零的内层位移：嵌套内容需要单独计算原点。
    file.tags[2] = sprite(21, [[placement(15, [1, 0, 0, 1, 31, -47])], [], [remove(1), placement(12, [1, 0, 0, 1, -17, 23])]]);
    const result = rebuildPet(writeSwf(file), clip);
    const output = readSwf(result.swf);
    const sprites = new Map(output.tags.filter((tag) => tag.code === 39).map((tag) => [tag.data.readUInt16LE(), tag]));
    const wrapper = sprites.get(21)!;
    expect(wrapper.data.readUInt16LE(2)).toBe(3);
    const firstPlacement = readTags(wrapper.data.subarray(4)).find((tag) => tag.code === 26)!;
    const innerId = firstPlacement.data.readUInt16LE(3);
    expect(innerId).not.toBe(15);
    expect(sprites.get(innerId)?.data.readUInt16LE(2)).toBe(4);
    // 复用原包装及其脚本，只替换子级引用。
    const restoredReference = Buffer.from(wrapper.data);
    const original = file.tags[2];
    const childOffset = wrapper.data.indexOf(firstPlacement.data) + 3;
    restoredReference.writeUInt16LE(15, childOffset);
    expect(restoredReference).toEqual(original.data);
    expect(output.tags.find((tag) => tag.code === 82)).toEqual(file.tags.find((tag) => tag.code === 82));
    expect(sprites.get(15)).toEqual(file.tags[1]);
    const spriteOrder = [...sprites.keys()];
    expect(spriteOrder.indexOf(innerId)).toBeGreaterThan(spriteOrder.indexOf(12));
    expect(spriteOrder.indexOf(innerId)).toBeLessThan(spriteOrder.indexOf(21));
    const innerTags = readTags(sprites.get(innerId)!.data.subarray(4));
    const placements = innerTags.filter((tag) => tag.code === 70);
    // 几何变换必须抵消包装内层的 (31, -47) 位移。
    expect(placements[0].data.subarray(6, 6 + matrix([20, 0, 0, 20, 92, 503]).length))
      .toEqual(matrix([20, 0, 0, 20, 92, 503]));
    // 客户端会在内层片段末尾停止播放；其子级继续循环播放待机动画。
    expect(placements.at(-1)!.data.readUInt16LE(4)).toBe(12);
    expect(placements.at(-1)!.data.subarray(6, 6 + matrix([1, 0, 0, 1, -48, 70]).length))
      .toEqual(matrix([1, 0, 0, 1, -48, 70]));
    expect(result.report.actions[1]).toMatchObject({ spriteId: 21, frames: 4, contentSpriteId: innerId });
  });

  it("preserves an appear wrapper that switches from idle to content on its second frame", () => {
    const { file, clip } = fixture();
    clip.sequences[1].name = "appear";
    file.tags[3] = sprite(8, [[label("appear"), placement(21)]]);
    const result = rebuildPet(writeSwf(file), clip);
    const output = readSwf(result.swf);
    const wrapper = output.tags.find((tag) => tag.code === 39 && tag.data.readUInt16LE() === 21)!;
    const ids = readTags(wrapper.data.subarray(4)).filter((tag) => tag.code === 26)
      .map((tag) => tag.data.readUInt16LE(3));
    expect(ids).toEqual([12, result.report.actions[1].contentSpriteId, 12]);
    const inner = output.tags.find((tag) => tag.code === 39 && tag.data.readUInt16LE() === ids[1])!;
    const first = readTags(inner.data.subarray(4)).find((tag) => tag.code === 70)!;
    expect(first.data.readUInt16LE(4)).not.toBe(12);
  });

  it("rejects ambiguous appear content instead of rebuilding a wrong layer", () => {
    const { file, clip } = fixture();
    clip.sequences[1].name = "appear";
    file.tags[3] = sprite(8, [[label("appear"), placement(21)]]);
    file.tags[1] = sprite(15, [[], []]);
    expect(() => discoverSource(file, clip)).toThrow("single-frame appear content");
    file.tags[1] = sprite(15, [[]]);
    file.tags[2] = sprite(21, [[placement(15, [1, 0, 0, 1, 3, 4])],
      [remove(1), placement(15)], [remove(1), placement(12)]]);
    expect(() => discoverSource(file, clip)).toThrow("Initial appear content differs");
    file.tags[2] = sprite(21, [[placement(12)], [], []]);
    expect(() => discoverSource(file, clip)).toThrow("single-frame appear content");
  });

  it("changes only generated bitmap resources when texture scaling is requested", () => {
    const { file, clip } = fixture();
    const source = writeSwf(file);
    const full = rebuildPet(source, clip);
    const half = rebuildPet(source, clip, { textureScale: 0.5 });
    const keep = (tag: Tag): boolean => ![91, 92].includes(tag.data.length >= 2 ? tag.data.readUInt16LE() : -1)
      || ![32, 36].includes(tag.code);
    expect(readSwf(half.swf).tags.filter(keep)).toEqual(readSwf(full.swf).tags.filter(keep));
    expect(half.report).toMatchObject({ textureScale: 0.5, bitmapPixelBytes: 4, originalBitmapPixelBytes: 16 });
    expect(full.report).toMatchObject({ textureScale: 1, bitmapPixelBytes: 16, originalBitmapPixelBytes: 16 });
    expect(half.report.actions).toEqual(full.report.actions);
    expect(rebuildPet(source, clip, { textureScale: 1 }).swf).toEqual(full.swf);
  });

  it("rebuilds an unseen source with arbitrary bindings, coordinates and clip metadata", () => {
    const { file, clip } = fixture();
    const layout = discoverSource(file, clip);
    expect(layout.petSpriteId).toBe(8);
    expect(layout.nextCharacterId).toBe(91);
    expect(layout.actions.map((action) => ({ id: action.id, origin: action.origin, hit: action.hit })))
      .toEqual([{ id: 12, origin: [140, 433], hit: undefined }, { id: 21, origin: [123, 456], hit: 3 }]);
    const result = rebuildPet(writeSwf(file), clip);
    expect(result.report.frameRate).toBe(30);
    expect(result.report.actions.map((action) => action.frames)).toEqual([2, 4]);
    const output = readSwf(result.swf);
    const generated = output.tags.filter((tag) => [32, 36].includes(tag.code) && tag.data.readUInt16LE() !== 90);
    expect(generated.map((tag) => tag.data.readUInt16LE())).toEqual([91, 92]);
    expect(output.tags.find((tag) => tag.code === 39 && tag.data.readUInt16LE() === 8)).toEqual(file.tags[3]);
    const preview = readSwf(result.previews.get("special")!);
    expect(preview.header.readUInt16LE(preview.header.length - 4)).toBe(30 * 256);
    expect(preview.tags.filter((tag) => tag.code === 1)).toHaveLength(4);
  });

  it("infers whether the entry frame contains idle without relying on the action name", () => {
    const { file, clip } = fixture();
    file.tags[2] = sprite(21, [[placement(15)], [], [remove(1), placement(12, [1, 0, 0, 1, -17, 23])]]);
    expect(discoverSource(file, clip).actions[1].idleAtStart).toBe(false);
    const output = readSwf(rebuildPet(writeSwf(file), clip).swf);
    const action = output.tags.find((tag) => tag.code === 39 && tag.data.readUInt16LE() === 21)!;
    const placements = readTags(action.data.subarray(4)).filter((tag) => tag.code === 70);
    expect(placements[0].data.readUInt16LE(4)).toBe(92);
    expect(placements.at(-1)!.data.readUInt16LE(4)).toBe(12);
  });

  it("rejects missing or ambiguous source and bundle bindings", () => {
    const { file, clip } = fixture();
    clip.sequences.push(clip.sequences[1]);
    expect(() => discoverSource(file, clip)).toThrow("Duplicate bundle sequence");
    clip.sequences.pop();
    clip.sequences[1].name = "different";
    expect(() => discoverSource(file, clip)).toThrow("Unmatched or duplicate action label");
    clip.sequences[1].name = "special";
    file.tags[5] = { code: 76, data: Buffer.concat([u16(1), u16(8), cstring("pet")]) };
    expect(() => discoverSource(file, clip)).toThrow("Missing SymbolClass");
  });

  it("rejects incompatible events and placement transforms instead of guessing", () => {
    const { file, clip } = fixture();
    clip.sequences[1].frames[0].labels.push("action_hit");
    expect(() => discoverSource(file, clip)).toThrow("hit event");
    clip.sequences[1].frames[0].labels = [];
    file.tags[3] = sprite(8, [[label("special"), placement(21, [2, 0, 0, 1, 0, 0])]]);
    expect(() => discoverSource(file, clip)).toThrow("translation only");
  });

  it("rejects wrappers whose idle coordinates disagree", () => {
    const { file, clip } = fixture();
    file.tags[3] = sprite(8, [
      [label("special"), placement(21)],
      [label("another"), remove(1), placement(22)],
    ]);
    file.tags.splice(4, 0, sprite(22, [
      [placement(12)], [remove(1), placement(15)], [remove(1), placement(12)],
    ]));
    clip.sequences.push({ ...clip.sequences[1], name: "another" });
    expect(() => discoverSource(file, clip)).toThrow("disagree on common idle placement");
  });

  it("rejects animated idle sprites and ambiguous multi-object wrappers", () => {
    const { file, clip } = fixture();
    file.tags[0] = sprite(12, [[], []]);
    expect(() => discoverSource(file, clip)).toThrow("single-frame common idle");
    file.tags[0] = sprite(12, [[]]);
    file.tags[2] = sprite(21, [
      [placement(12), placement(15, [1, 0, 0, 1, 0, 0], 2)],
      [], [],
    ]);
    expect(() => discoverSource(file, clip)).toThrow("Expected one MovieClip");
  });
});
