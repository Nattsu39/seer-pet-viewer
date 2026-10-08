import { BitReader, Reader } from "./binary.js";
import { readTags, type Matrix, type SwfFile, type Tag } from "./swf.js";
import type { Clip, Sequence } from "./types.js";

type Translation = [number, number];
interface Placement {
  id: number;
  matrix: Matrix;
}
interface TimelineFrame {
  labels: string[];
  objects: Map<number, Placement>;
}
export interface SourceAction {
  id: number;
  sequence: Sequence;
  origin: Translation;
  className?: string;
  hit?: number;
  idlePlacement?: Translation;
  idleAtStart?: boolean;
  /** 客户端在已停止的三帧控制包装内播放出场动画。 */
  content?: { id: number; translation: Translation; wrapper: Tag };
}
export interface SourceLayout {
  petSpriteId: number;
  idleSpriteId: number;
  nextCharacterId: number;
  actions: SourceAction[];
}

// 定义角色的标签都以 UI16 类型的 CharacterId 开头。
// 字体元数据、缩放网格和符号绑定只引用已有 ID，不属于资源定义。
const definitionCodes = new Set([
  2, 6, 7, 10, 11, 14, 20, 21, 22, 32, 33, 34, 35, 36, 37, 39, 46, 48, 60, 75,
  83, 84, 87, 90, 91,
]);
export const isCharacterDefinition = (tag: Tag): boolean =>
  definitionCodes.has(tag.code);

function readMatrix(reader: Reader): Matrix {
  const bits = new BitReader(reader.data.slice(reader.position));
  let a = 1,
    d = 1,
    b = 0,
    c = 0;
  if (bits.read(1)) {
    const count = bits.read(5);
    a = bits.read(count, true) / 65536;
    d = bits.read(count, true) / 65536;
  }
  if (bits.read(1)) {
    const count = bits.read(5);
    b = bits.read(count, true) / 65536;
    c = bits.read(count, true) / 65536;
  }
  const count = bits.read(5);
  const translation: Translation = [
    bits.read(count, true),
    bits.read(count, true),
  ];
  reader.take(bits.bytes);
  return [a, b, c, d, ...translation];
}

/** 仅对保留的包装层变换要求纯平移；普通内容帧已展开到 bundle 顶点。 */
function translationOf(placement: Placement): Translation {
  const [a, b, c, d, x, y] = placement.matrix;
  if (a !== 1 || d !== 1 || b !== 0 || c !== 0) {
    throw new Error("Source action/idle placement must use translation only");
  }
  return [x, y];
}

function readIdentityColor(reader: Reader): void {
  const bits = new BitReader(reader.data.slice(reader.position));
  const hasAdd = bits.read(1),
    hasMultiply = bits.read(1),
    count = bits.read(4);
  const multiply = hasMultiply
    ? Array.from({ length: 4 }, () => bits.read(count, true))
    : [256, 256, 256, 256];
  const add = hasAdd
    ? Array.from({ length: 4 }, () => bits.read(count, true))
    : [0, 0, 0, 0];
  reader.take(bits.bytes);
  if (
    multiply.some((value) => value !== 256) ||
    add.some((value) => value !== 0)
  ) {
    throw new Error(
      "Source action/idle placement has an unsupported color transform",
    );
  }
}

/** 重放显示列表：标签可能与移动指令同帧出现，也可能没有新的放置指令。 */
function timeline(tag: Tag): TimelineFrame[] {
  const objects = new Map<number, Placement>();
  const frames: TimelineFrame[] = [];
  let labels: string[] = [];
  for (const entry of readTags(tag.data.slice(4))) {
    const reader = new Reader(entry.data);
    if (entry.code === 26) {
      const flags = reader.u8(),
        depth = reader.u16();
      const previous = flags & 1 ? objects.get(depth) : undefined;
      if (flags & 1 && !previous)
        throw new Error("Source move references an empty depth");
      const id = flags & 2 ? reader.u16() : previous?.id;
      const matrix =
        flags & 4
          ? readMatrix(reader)
          : (previous?.matrix ?? ([1, 0, 0, 1, 0, 0] as Matrix));
      if (flags & 8) readIdentityColor(reader);
      if (flags & 16) reader.u16(); // Ratio 不影响 MovieClip 包装。
      if (flags & 32) reader.string();
      if (flags & 0xc0)
        throw new Error("Source wrapper uses clipping or clip actions");
      if (id === undefined || reader.position !== entry.data.length)
        throw new Error("Invalid source placement");
      objects.set(depth, { id, matrix });
    } else if (entry.code === 28) {
      objects.delete(reader.u16());
    } else if (entry.code === 43) {
      labels.push(reader.string());
    } else if (entry.code === 1) {
      frames.push({ labels, objects: new Map(objects) });
      labels = [];
    } else if (entry.code !== 0) {
      throw new Error(`Unsupported source wrapper tag ${entry.code}`);
    }
  }
  if (frames.length !== tag.data.readUInt16LE(2))
    throw new Error("Source sprite frame count mismatch");
  return frames;
}

function singlePlacement(frame: TimelineFrame): Placement {
  if (frame.objects.size !== 1)
    throw new Error("Expected one MovieClip in the source wrapper frame");
  return frame.objects.values().next().value!;
}

function validateEvents(
  sequence: Sequence,
  action: boolean,
): number | undefined {
  const frames = sequence.frames.length;
  if (!frames || frames > 65535)
    throw new Error(`Invalid ${sequence.name} frame count`);
  const events = (name: string): number[] =>
    sequence.frames.flatMap((frame, index) =>
      frame.labels.filter((label) => label === name).map(() => index + 1),
    );
  const ends = events("action_end"),
    hits = events("action_hit");
  if (ends.length !== 1 || ends[0] !== frames)
    throw new Error(`Unexpected ${sequence.name} end event`);
  if (
    action
      ? hits.length !== 1 || hits[0] <= 1 || hits[0] >= frames
      : hits.length !== 0
  ) {
    throw new Error(`Unexpected ${sequence.name} hit event`);
  }
  return hits[0];
}

/** 根据精简后的 Flash 外壳结构推断约定，不依赖宠物 ID、哈希或类名模式。 */
export function discoverSource(file: SwfFile, clip: Clip): SourceLayout {
  const sprites = new Map<number, Tag>();
  const symbols = new Map<number, string>();
  const characterIds = new Set<number>();
  for (const tag of file.tags) {
    if (isCharacterDefinition(tag)) {
      const id = tag.data.readUInt16LE(0);
      if (!id || characterIds.has(id))
        throw new Error(`Duplicate or invalid CharacterId ${id}`);
      characterIds.add(id);
      if (tag.code === 39) {
        if (readTags(tag.data.slice(4)).some(isCharacterDefinition)) {
          throw new Error("Nested character definitions are not supported");
        }
        sprites.set(id, tag);
      }
    }
    if (tag.code === 76) {
      const reader = new Reader(tag.data);
      const count = reader.u16();
      for (let i = 0; i < count; i++) {
        const id = reader.u16(),
          name = reader.string();
        if (symbols.has(id))
          throw new Error(`Duplicate SymbolClass binding ${id}`);
        symbols.set(id, name);
      }
    }
  }
  const pets = [...symbols].filter(([, name]) => name === "pet");
  if (pets.length !== 1 || !sprites.has(pets[0][0]))
    throw new Error("Expected one exported pet MovieClip");
  const petSpriteId = pets[0][0];
  const sequences = new Map<string, Sequence>();
  for (const sequence of clip.sequences) {
    if (sequences.has(sequence.name))
      throw new Error(`Duplicate bundle sequence ${sequence.name}`);
    sequences.set(sequence.name, sequence);
  }
  const standby = sequences.get("standby");
  if (!standby) throw new Error("Missing standby sequence");
  validateEvents(standby, false);
  const actions: SourceAction[] = [];
  let idleSpriteId: number | undefined;
  let idleOrigin: Translation | undefined;
  const seen = new Set<string>();
  for (const frame of timeline(sprites.get(petSpriteId)!)) {
    for (const name of frame.labels) {
      // 保留的受击动画已有完整的原始时间轴。
      if (name === "hited") continue;
      const sequence = sequences.get(name);
      if (!sequence || name === "standby" || seen.has(name))
        throw new Error(`Unmatched or duplicate action label ${name}`);
      seen.add(name);
      const parent = singlePlacement(frame);
      const parentTranslation = translationOf(parent);
      const wrapper = sprites.get(parent.id);
      if (!wrapper) throw new Error(`Missing action sprite ${parent.id}`);
      const frames = timeline(wrapper);
      if (frames.length !== 3)
        throw new Error(`Expected a three-frame trimmed wrapper for ${name}`);
      frames.forEach(singlePlacement);
      const first = singlePlacement(frames[0]),
        last = singlePlacement(frames[2]);
      if (!sprites.has(last.id))
        throw new Error("Common idle is not a MovieClip");
      const idlePlacement = translationOf(last);
      const origin: Translation = [
        -parentTranslation[0],
        -parentTranslation[1],
      ];
      if (idleSpriteId !== undefined && idleSpriteId !== last.id) {
        throw new Error("Action wrappers disagree on common idle sprite");
      }
      idleSpriteId = last.id;
      // 首个包装确定 standby 的局部原点；其余包装保留各自的待机位移，
      // 让同一待机子级在不同父层下仍呈现源文件中的相对位置。
      idleOrigin ??= [
        origin[0] - idlePlacement[0],
        origin[1] - idlePlacement[1],
      ];
      const className = symbols.get(parent.id);
      if (!className)
        throw new Error(`Missing SymbolClass binding for ${name}`);
      const idleAtStart = first.id === last.id;
      if (
        idleAtStart &&
        translationOf(first).some(
          (value, index) => value !== idlePlacement[index],
        )
      ) {
        throw new Error("Initial and final idle placements differ");
      }
      let content: SourceAction["content"];
      // "appear" 是客户端接口标签，不是资源名或类名约定。
      // PlayerPetView 会在包装的第 2 帧停止，然后播放第一个子级。
      if (name === "appear") {
        const middle = singlePlacement(frames[1]);
        const middleTranslation = translationOf(middle);
        const inner = sprites.get(middle.id);
        if (
          !inner ||
          inner.data.readUInt16LE(2) !== 1 ||
          symbols.has(middle.id) ||
          middle.id === last.id ||
          middle.id === parent.id
        ) {
          throw new Error(
            "Expected an unbound single-frame appear content MovieClip distinct from idle and wrapper",
          );
        }
        if (
          first.id !== last.id &&
          (first.id !== middle.id ||
            translationOf(first).some(
              (value, index) => value !== middleTranslation[index],
            ))
        ) {
          throw new Error(
            "Initial appear content differs from the frame-2 placement",
          );
        }
        content = { id: middle.id, translation: middleTranslation, wrapper };
      }
      actions.push({
        id: parent.id,
        sequence,
        origin,
        className,
        hit: validateEvents(sequence, true),
        idlePlacement,
        idleAtStart,
        ...(content ? { content } : {}),
      });
    }
  }
  if (idleSpriteId === undefined || !idleOrigin)
    throw new Error("No reconstructable action wrappers");
  if (
    sprites.get(idleSpriteId)!.data.readUInt16LE(2) !== 1 ||
    symbols.has(idleSpriteId)
  ) {
    throw new Error("Expected an unbound single-frame common idle sprite");
  }
  for (const name of sequences.keys()) {
    if (name !== "standby" && name !== "hited" && !seen.has(name))
      throw new Error(`Bundle action ${name} has no source entry`);
  }
  actions.unshift({ id: idleSpriteId, sequence: standby, origin: idleOrigin });
  if (
    new Set(actions.map((action) => action.id)).size !== actions.length ||
    actions.some((action) => action.id === petSpriteId)
  ) {
    throw new Error("Source action sprites alias each other or their parent");
  }
  return {
    petSpriteId,
    idleSpriteId,
    nextCharacterId: Math.max(...characterIds) + 1,
    actions,
  };
}
