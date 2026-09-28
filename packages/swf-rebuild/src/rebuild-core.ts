import { Buffer } from "buffer";
import { patchFrameRegistrations, type FrameRegistration } from "./abc.js";
import { Reader, u16 } from "./binary.js";
import {
  encodeTag,
  end,
  label,
  place,
  readSwf,
  readTags,
  rect,
  remove,
  showFrame,
  sprite,
  writeSwf,
  browserCompression,
  type Tag,
} from "./swf.js";
import type { Clip, RebuildOptions, RebuildReport, Sequence } from "./types.js";
import { validateTextureScale } from "./textures.js";

import { framePlacements } from "./frames.js";
import {
  discoverSource,
  isCharacterDefinition,
  type SourceAction,
} from "./source.js";
import { ResourceDictionary } from "./resources.js";

export { quadMatrix, unpackColor } from "./frames.js";

function contentOrigin(action: SourceAction): [number, number] {
  const offset = action.content?.translation ?? [0, 0];
  return [action.origin[0] - offset[0], action.origin[1] - offset[1]];
}

/** 保留原控制时间轴，只改写其中指向动画内容的引用。 */
function replaceContent(
  wrapper: Tag,
  originalId: number,
  replacementId: number,
): Tag {
  const tags = readTags(wrapper.data.slice(4)).map((tag) => {
    if (
      tag.code !== 26 ||
      !(tag.data[0] & 2) ||
      tag.data.readUInt16LE(3) !== originalId
    )
      return tag;
    const data = Buffer.from(tag.data);
    data.writeUInt16LE(replacementId, 3);
    return { code: tag.code, data };
  });
  return {
    code: wrapper.code,
    data: Buffer.concat([wrapper.data.slice(0, 4), ...tags.map(encodeTag)]),
  };
}

function frameList(placements: Tag[][], sequence: Sequence): Tag[][] {
  return placements.map((entries, index) => [
    ...Array.from(
      { length: index ? placements[index - 1].length : 0 },
      (_, depth) => remove(depth + 1),
    ),
    ...sequence.frames[index].labels.map(label),
    ...entries,
  ]);
}

export interface RebuildCoreResult {
  swf: Buffer;
  /** 每个重建动作对应的无脚本紧凑预览影片。 */
  previews: Map<string, Buffer>;
  report: Omit<RebuildReport, "sourceSha256" | "outputSha256">;
}

export interface RebuildResult extends RebuildCoreResult {
  report: RebuildReport;
}

/** 使用 SWF 的结构和 bundle 中的动画数据恢复时间轴。 */
export function rebuildPetCore(
  source: Buffer,
  clip: Clip,
  options: RebuildOptions = {},
  compression = browserCompression,
): RebuildCoreResult {
  const textureScale = validateTextureScale(options.textureScale ?? 1);
  const file = readSwf(source, compression);
  const frameRate = file.header.readUInt16LE(file.header.length - 4) / 256;
  if (
    clip.frameRate !== frameRate ||
    frameRate <= 0 ||
    !Number.isFinite(clip.pixelsPerUnit) ||
    clip.pixelsPerUnit <= 0 ||
    ![clip.atlas.width, clip.atlas.height].every(
      (value) => Number.isInteger(value) && value > 0 && value <= 65535,
    ) ||
    clip.atlas.rgba.length !== clip.atlas.width * clip.atlas.height * 4
  ) {
    throw new Error(
      "Invalid clip metadata or source/bundle frame-rate mismatch",
    );
  }
  const layout = discoverSource(file, clip);
  const dictionary = new ResourceDictionary(
    clip.atlas,
    layout.nextCharacterId,
    textureScale,
    compression,
  );
  const replacements = new Map<number, Tag>();
  const contentSprites = new Map<number, Tag>();
  const previews = new Map<string, Buffer>();
  const previewFrames = new Map<string, Tag[][]>();
  const registrations: FrameRegistration[] = [];
  const actions: RebuildReport["actions"] = [];
  let totalMasks = 0;
  for (const action of layout.actions) {
    const { sequence, hit } = action;
    const origin = contentOrigin(action);
    const frames = sequence.frames.map((frame) =>
      framePlacements(frame, dictionary, clip.pixelsPerUnit, origin),
    );
    const placements = frames.map((frame) => frame.tags);
    totalMasks += frames.reduce((count, frame) => count + frame.maskCount, 0);
    if (options.includePreviews !== false) {
      previewFrames.set(sequence.name, frameList(placements, sequence));
    }
    if (action.className) {
      if (action.hit === undefined)
        throw new Error(`Missing hit frame for ${sequence.name}`);
      registrations.push({
        className: action.className,
        frames: action.content
          ? [0, 1, 2]
          : [0, action.hit - 1, sequence.frames.length - 1],
      });
      // 动作停止后仍须显示循环播放的待机 MovieClip，以符合源包装的约定。
      // 动作中间帧则使用展开后的数据。
      const offset = action.content?.translation ?? [0, 0];
      const idle = (): Tag[] => [
        place(layout.idleSpriteId, 1, [
          1,
          0,
          0,
          1,
          action.idlePlacement![0] - offset[0],
          action.idlePlacement![1] - offset[1],
        ]),
      ];
      if (!action.content && action.idleAtStart !== false)
        placements[0] = idle();
      placements[placements.length - 1] = idle();
    }
    let contentSpriteId: number | undefined;
    if (action.content) {
      // 为动画内容分配独立资源，避免影响指向原资源的其他引用。
      const content = dictionary.createSprite(frameList(placements, sequence));
      contentSpriteId = content.data.readUInt16LE(0);
      contentSprites.set(action.id, content);
      replacements.set(
        action.id,
        replaceContent(
          action.content.wrapper,
          action.content.id,
          contentSpriteId,
        ),
      );
    } else {
      replacements.set(
        action.id,
        sprite(action.id, frameList(placements, sequence)),
      );
    }
    actions.push({
      name: sequence.name,
      spriteId: action.id,
      frames: sequence.frames.length,
      ...(hit ? { hitFrame: hit } : {}),
      ...(contentSpriteId !== undefined ? { contentSpriteId } : {}),
      maskFrames: frames.filter((frame) => frame.maskCount > 0).length,
    });
  }
  let abcCount = 0;
  const replaced = new Set<number>();
  file.tags = file.tags.map((tag) => {
    if (tag.code === 39) {
      const id = tag.data.readUInt16LE(0);
      const replacement = replacements.get(id);
      if (replacement) {
        replaced.add(id);
        return replacement;
      }
    }
    if (tag.code === 82) {
      abcCount++;
      const reader = new Reader(tag.data);
      reader.u32();
      reader.string();
      return {
        code: 82,
        data: Buffer.concat([
          tag.data.slice(0, reader.position),
          patchFrameRegistrations(
            tag.data.slice(reader.position),
            registrations,
          ),
        ]),
      };
    }
    return tag;
  });
  if (abcCount !== 1 || replaced.size !== replacements.size)
    throw new Error("Expected one ABC block and all discovered action sprites");
  // 将嵌套内容定义在包装之前，并放在它引用的原待机资源之后。
  // 无脚本预览不需要这些影片片段。
  file.tags = file.tags.flatMap((tag) => {
    const content =
      tag.code === 39
        ? contentSprites.get(tag.data.readUInt16LE(0))
        : undefined;
    return content ? [content, tag] : [tag];
  });
  const firstDefinition = file.tags.findIndex(isCharacterDefinition);
  if (firstDefinition < 0) throw new Error("No dictionary insertion point");
  file.tags.splice(firstDefinition, 0, ...dictionary.tags);
  const swf = writeSwf(file, compression);

  for (const [name, frames] of previewFrames) {
    const sequence = clip.sequences.find((entry) => entry.name === name)!;
    const origin = contentOrigin(
      layout.actions.find((action) => action.sequence.name === name)!,
    );
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const frame of sequence.frames)
      for (const vertex of frame.vertices) {
        const x = Math.round(vertex.x * clip.pixelsPerUnit * 20 + origin[0]);
        const y = Math.round(-vertex.y * clip.pixelsPerUnit * 20 + origin[1]);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    if (!Number.isFinite(minX))
      throw new Error(`No visible geometry in ${name}`);
    const header = Buffer.concat([
      rect([minX - 200, maxX + 200, minY - 200, maxY + 200]),
      u16(frameRate * 256),
      u16(frames.length),
    ]);
    previews.set(
      name,
      writeSwf(
        {
          version: 10,
          header,
          tags: [
            { code: 69, data: Buffer.alloc(4) },
            ...dictionary.tags,
            ...frames.flatMap((frame) => [...frame, showFrame()]),
            end(),
          ],
        },
        compression,
      ),
    );
  }
  // 返回结果前，完整执行一次帧边界的往返校验。
  if (!writeSwf(readSwf(swf, compression), compression).equals(swf))
    throw new Error("SWF framing round trip failed");
  return {
    swf,
    previews,
    report: {
      petSpriteId: layout.petSpriteId,
      bitmapCount: dictionary.regions.size,
      textureScale,
      bitmapPixelBytes: dictionary.bitmapPixelBytes,
      originalBitmapPixelBytes: dictionary.originalBitmapPixelBytes,
      maskShapeCount: dictionary.masks.size,
      maskPlacements: totalMasks,
      frameRate,
      actions,
      warnings: [
        ...(textureScale < 1
          ? [
              "Generated bitmap resolution is reduced; fine texture details may be lost.",
            ]
          : []),
        "Overlay/Hardlight use native Flash modes; Unity grab-pass grouping can differ.",
        "CXFORM multiplier precision is 1/256; Unity stores 1/512. RGB alpha-gating near zero is approximate.",
        ...(totalMasks
          ? [
              "Mask geometry uses alpha >= 3/255 at texel centers; filtered mask edges can differ from Unity.",
            ]
          : []),
        "The retained hited timeline is unchanged; its common idle child is restored.",
      ],
    },
  };
}
