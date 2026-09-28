import { Buffer } from "buffer";
import { Reader, encodedU30 } from "./binary.js";

export interface FrameRegistration {
  className: string;
  /** 现有停止、命中和停止处理器对应的零基帧索引。 */
  frames: [number, number, number];
}

/**
 * 通过 ABC 表定位构造函数，并在替换帧操作数前验证完整的操作码序列。
 * 较大的操作数使用 pushshort，同时重新计算方法的 code_length。
 * 这里只接受没有分支和异常处理器的桩函数，因此无需调整控制流偏移。
 * 其他方法和常量池均保留原始字节。
 */
export function patchFrameRegistrations(
  data: Buffer,
  registrations: FrameRegistration[],
): Buffer {
  const reader = new Reader(data);
  const minor = reader.u16();
  const major = reader.u16();
  if (major !== 46 || minor !== 16)
    throw new Error(`Unsupported ABC version ${major}.${minor}`);

  for (let pool = 0; pool < 2; pool++) {
    const count = reader.encoded();
    for (let i = 1; i < count; i++) reader.encoded();
  }
  const doubles = reader.encoded();
  reader.take(Math.max(0, doubles - 1) * 8);
  const strings = [""];
  const stringCount = reader.encoded();
  for (let i = 1; i < stringCount; i++)
    strings.push(reader.take(reader.encoded()).toString("utf8"));
  const namespaces = [""];
  const namespaceCount = reader.encoded();
  for (let i = 1; i < namespaceCount; i++) {
    reader.u8();
    namespaces.push(strings[reader.encoded()]);
  }
  const sets = reader.encoded();
  for (let i = 1; i < sets; i++) {
    const count = reader.encoded();
    for (let j = 0; j < count; j++) reader.encoded();
  }
  const names: { local: string; qualified: string }[] = [
    { local: "", qualified: "" },
  ];
  const nameCount = reader.encoded();
  for (let i = 1; i < nameCount; i++) {
    const kind = reader.u8();
    let local = "";
    let namespace = "";
    switch (kind) {
      case 0x07:
      case 0x0d:
        namespace = namespaces[reader.encoded()];
        local = strings[reader.encoded()];
        break;
      case 0x0f:
      case 0x10:
        local = strings[reader.encoded()];
        break;
      case 0x11:
      case 0x12:
        break;
      case 0x09:
      case 0x0e:
        local = strings[reader.encoded()];
        reader.encoded();
        break;
      case 0x1b:
      case 0x1c:
        reader.encoded();
        break;
      case 0x1d: {
        reader.encoded();
        const count = reader.encoded();
        for (let j = 0; j < count; j++) reader.encoded();
        break;
      }
      default:
        throw new Error(`Unsupported ABC multiname kind ${kind}`);
    }
    names.push({
      local,
      qualified: namespace ? `${namespace}.${local}` : local,
    });
  }

  const methods = reader.encoded();
  for (let i = 0; i < methods; i++) {
    const parameters = reader.encoded();
    reader.encoded();
    for (let j = 0; j < parameters; j++) reader.encoded();
    reader.encoded();
    const flags = reader.u8();
    if (flags & 8) {
      const count = reader.encoded();
      for (let j = 0; j < count; j++) {
        reader.encoded();
        reader.u8();
      }
    }
    if (flags & 128) for (let j = 0; j < parameters; j++) reader.encoded();
  }
  const metadata = reader.encoded();
  for (let i = 0; i < metadata; i++) {
    reader.encoded();
    const count = reader.encoded();
    for (let j = 0; j < count * 2; j++) reader.encoded();
  }

  function traits(): void {
    const count = reader.encoded();
    for (let i = 0; i < count; i++) {
      reader.encoded();
      const kind = reader.u8();
      switch (kind & 15) {
        case 0:
        case 6:
          reader.encoded();
          reader.encoded();
          if (reader.encoded()) reader.u8();
          break;
        case 1:
        case 2:
        case 3:
        case 4:
        case 5:
          reader.encoded();
          reader.encoded();
          break;
        default:
          throw new Error(`Unsupported ABC trait ${kind & 15}`);
      }
      if (kind & 64) {
        const entries = reader.encoded();
        for (let j = 0; j < entries; j++) reader.encoded();
      }
    }
  }

  const targets = new Map(
    registrations.map((entry) => [entry.className, entry]),
  );
  if (targets.size !== registrations.length)
    throw new Error("Duplicate ABC registration target");
  const constructors = new Map<number, FrameRegistration>();
  const classes = reader.encoded();
  for (let i = 0; i < classes; i++) {
    const name = names[reader.encoded()]?.qualified;
    reader.encoded();
    if (reader.u8() & 8) reader.encoded();
    const interfaces = reader.encoded();
    for (let j = 0; j < interfaces; j++) reader.encoded();
    const initializer = reader.encoded();
    const target = targets.get(name);
    if (target) constructors.set(initializer, target);
    traits();
  }
  for (let i = 0; i < classes; i++) {
    reader.encoded();
    traits();
  }
  const scripts = reader.encoded();
  for (let i = 0; i < scripts; i++) {
    reader.encoded();
    traits();
  }

  const edits: { start: number; end: number; replacement: Buffer }[] = [];
  const patched = new Set<string>();
  const bodies = reader.encoded();
  for (let i = 0; i < bodies; i++) {
    const method = reader.encoded();
    for (let j = 0; j < 4; j++) reader.encoded(); // 操作数栈、局部变量、作用域深度。
    const lengthOffset = reader.position;
    const length = reader.encoded();
    const offset = reader.position;
    const code = new Reader(reader.take(length));
    const target = constructors.get(method);
    if (target) {
      const parts: Buffer[] = [];
      let copied = 0;
      const fail = (): never => {
        throw new Error(`Unexpected constructor in ${target.className}`);
      };
      const opcode = (expected: number): void => {
        if (code.u8() !== expected) fail();
      };
      const property = (expected: string): void => {
        if (names[code.encoded()]?.local !== expected) fail();
      };
      opcode(0xd0);
      opcode(0x30);
      opcode(0xd0);
      opcode(0x49);
      if (code.encoded() !== 0) fail();
      opcode(0x5d);
      property("addFrameScript");
      for (let index = 0; index < 3; index++) {
        const frame = target.frames[index];
        if (!Number.isInteger(frame) || frame < 0 || frame > 32767) {
          throw new Error(
            "This stub patcher supports frame indices 0..32767 only",
          );
        }
        const instruction = code.position;
        opcode(0x24);
        if (code.u8() !== index) fail();
        parts.push(
          code.data.slice(copied, instruction),
          frame <= 127
            ? Buffer.from([0x24, frame])
            : Buffer.concat([Buffer.from([0x25]), encodedU30(frame)]),
        );
        copied = code.position;
        opcode(0xd0);
        opcode(0x66);
        property(`frame${index + 1}`);
      }
      opcode(0x4f);
      property("addFrameScript");
      if (code.encoded() !== 6) fail();
      opcode(0x47);
      if (code.position !== length || patched.has(target.className)) fail();
      parts.push(code.data.slice(copied));
      const replacement = Buffer.concat(parts);
      edits.push({
        start: lengthOffset,
        end: offset + length,
        replacement: Buffer.concat([
          encodedU30(replacement.length),
          replacement,
        ]),
      });
      patched.add(target.className);
    }
    const exceptions = reader.encoded();
    if (target && exceptions)
      throw new Error("Stub constructors must not have exception handlers");
    for (let j = 0; j < exceptions * 5; j++) reader.encoded();
    traits();
  }
  if (reader.position !== data.length) throw new Error("Trailing ABC bytes");
  if (patched.size !== targets.size)
    throw new Error("Not all requested ABC constructors were found");
  const parts: Buffer[] = [];
  let copied = 0;
  for (const edit of edits) {
    parts.push(data.slice(copied, edit.start), edit.replacement);
    copied = edit.end;
  }
  parts.push(data.slice(copied));
  return Buffer.concat(parts);
}
