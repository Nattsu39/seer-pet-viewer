import { Buffer } from "buffer";
import { zlibSync, unzlibSync } from "fflate";
import {
  BitReader,
  BitWriter,
  Reader,
  cstring,
  signedBits,
  u16,
  u32,
} from "./binary.js";
import { downsampleArgb } from "./textures.js";
import type { TextureScale } from "./types.js";

export interface SwfCompression {
  deflate(bytes: Uint8Array): Uint8Array;
  inflate(bytes: Uint8Array): Uint8Array;
}

export const browserCompression: SwfCompression = {
  deflate: zlibSync,
  inflate: unzlibSync,
};

export interface Tag {
  code: number;
  data: Buffer;
}
export type Matrix = [number, number, number, number, number, number];
export interface SwfFile {
  version: number;
  header: Buffer;
  tags: Tag[];
}

export function readTags(bytes: Buffer): Tag[] {
  const reader = new Reader(bytes);
  const result: Tag[] = [];
  while (reader.position < bytes.length) {
    const header = reader.u16();
    const length = (header & 63) === 63 ? reader.u32() : header & 63;
    const tag = { code: header >> 6, data: reader.take(length) };
    result.push(tag);
    if (tag.code === 0) {
      if (length || reader.position !== bytes.length)
        throw new Error("Invalid End tag or trailing data");
      return result;
    }
  }
  throw new Error("Missing SWF End tag");
}

export function encodeTag(tag: Tag): Buffer {
  // 无损位图标签即使数据很短，也必须使用长格式 RECORDHEADER。
  const long = tag.data.length >= 63 || tag.code === 36;
  return Buffer.concat([
    u16((tag.code << 6) | (long ? 63 : tag.data.length)),
    ...(long ? [u32(tag.data.length)] : []),
    tag.data,
  ]);
}

export function readSwf(
  bytes: Buffer,
  compression = browserCompression,
): SwfFile {
  const signature = bytes.slice(0, 3).toString("ascii");
  if (signature !== "CWS" && signature !== "FWS")
    throw new Error("Expected a CWS or FWS file");
  const body =
    signature === "CWS"
      ? Buffer.from(compression.inflate(bytes.slice(8)))
      : bytes.slice(8);
  if (bytes.readUInt32LE(4) !== body.length + 8)
    throw new Error("SWF length mismatch");
  const bits = new BitReader(body);
  const count = bits.read(5);
  for (let i = 0; i < 4; i++) bits.read(count, true);
  const header = body.slice(0, bits.bytes + 4);
  if (header.length !== bits.bytes + 4) throw new Error("Truncated SWF header");
  return {
    version: bytes[3],
    header,
    tags: readTags(body.slice(header.length)),
  };
}

export function writeSwf(
  file: SwfFile,
  compression = browserCompression,
): Buffer {
  const body = Buffer.concat([file.header, ...file.tags.map(encodeTag)]);
  return Buffer.concat([
    Buffer.from([67, 87, 83, file.version]),
    u32(body.length + 8),
    compression.deflate(body),
  ]);
}

export function rect(values: [number, number, number, number]): Buffer {
  const bits = new BitWriter();
  const count = signedBits(values);
  bits.write(count, 5);
  for (const value of values) bits.write(value, count);
  return bits.bytes();
}

export function matrix(values: Matrix): Buffer {
  const bits = new BitWriter();
  const [a, b, c, d, tx, ty] = values;
  for (const [present, entries] of [
    [a !== 1 || d !== 1, [a, d]],
    [b !== 0 || c !== 0, [b, c]],
  ] as const) {
    bits.write(present ? 1 : 0, 1);
    if (present) {
      const fixed = entries.map((value) => Math.round(value * 65536));
      const count = signedBits(fixed);
      bits.write(count, 5);
      for (const value of fixed) bits.write(value, count);
    }
  }
  const translation = [Math.round(tx), Math.round(ty)];
  const count = signedBits(translation);
  bits.write(count, 5);
  for (const value of translation) bits.write(value, count);
  return bits.bytes();
}

export function colorTransform(mul: number[], add: number[]): Buffer {
  const multiply = mul.map((value) => Math.round(value * 256));
  const addition = add.map((value) => Math.round(value * 255));
  const count = signedBits([...multiply, ...addition]);
  if (count > 15)
    throw new Error("Color transform exceeds CXFORMWITHALPHA range");
  const bits = new BitWriter();
  bits.write(1, 1);
  bits.write(1, 1);
  bits.write(count, 4);
  for (const value of [...multiply, ...addition]) bits.write(value, count);
  return bits.bytes();
}

export function bitmap(
  id: number,
  width: number,
  height: number,
  rgba: Uint8Array,
  scale: TextureScale = 1,
  compression = browserCompression,
): Tag {
  if (rgba.length !== width * height * 4)
    throw new Error("Bitmap size mismatch");
  const argb = Buffer.alloc(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const alpha = rgba[i + 3];
    argb[i] = alpha;
    for (let channel = 0; channel < 3; channel++) {
      argb[i + 1 + channel] = Math.round((rgba[i + channel] * alpha) / 255);
    }
  }
  const pixels = downsampleArgb(argb, width, height, scale);
  return {
    code: 36,
    data: Buffer.concat([
      u16(id),
      Buffer.from([5]),
      u16(Math.ceil(width * scale)),
      u16(Math.ceil(height * scale)),
      compression.deflate(pixels),
    ]),
  };
}

export function bitmapShape(
  id: number,
  bitmapId: number,
  width: number,
  height: number,
  bitmapWidth = width,
  bitmapHeight = height,
): Tag {
  const bits = new BitWriter();
  bits.write(1, 4);
  bits.write(0, 4); // 一个填充位，不包含线条。
  bits.write(0, 1);
  bits.write(5, 5); // MoveTo 和 FillStyle1。
  bits.write(1, 5);
  bits.write(0, 1);
  bits.write(0, 1);
  bits.write(1, 1);
  for (const [dx, dy] of [
    [width * 20, 0],
    [0, height * 20],
    [-width * 20, 0],
    [0, -height * 20],
  ]) {
    // 直线边的有符号增量最多为 17 位，因此需要拆分较大的矩形。
    const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 60000);
    let previous = 0;
    for (let step = 1; step <= steps; step++) {
      const target = Math.round(((dx || dy) * step) / steps);
      const delta = target - previous;
      previous = target;
      const count = Math.max(2, signedBits([delta]));
      bits.write(1, 1);
      bits.write(1, 1);
      bits.write(count - 2, 4);
      bits.write(0, 1);
      bits.write(dx === 0 ? 1 : 0, 1);
      bits.write(delta, count);
    }
  }
  bits.write(0, 6);
  return {
    code: 32,
    data: Buffer.concat([
      u16(id),
      rect([0, width * 20, 0, height * 20]),
      Buffer.from([1, 0x41]),
      u16(bitmapId),
      matrix([
        (20 * width) / bitmapWidth,
        0,
        0,
        (20 * height) / bitmapHeight,
        0,
        0,
      ]),
      Buffer.from([0]),
      bits.bytes(),
    ]),
  };
}

export function place(
  id: number,
  depth: number,
  transform: Matrix,
  mul = [1, 1, 1, 1],
  add = [0, 0, 0, 0],
  blend = 1,
): Tag {
  return {
    code: 70,
    data: Buffer.concat([
      Buffer.from([0x0e, 0x02]),
      u16(depth),
      u16(id),
      matrix(transform),
      colorTransform(mul, add),
      Buffer.from([blend]),
    ]),
  };
}

export interface PixelRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 必须使用实体几何：Flash 遮罩层会忽略位图的 alpha 通道。 */
export function maskShape(
  id: number,
  width: number,
  height: number,
  rectangles: PixelRectangle[],
): Tag {
  const bits = new BitWriter();
  bits.write(1, 4);
  bits.write(0, 4);
  for (const rectangle of rectangles) {
    const { x, y, width: w, height: h } = rectangle;
    if (
      ![x, y, w, h].every(Number.isInteger) ||
      x < 0 ||
      y < 0 ||
      w <= 0 ||
      h <= 0 ||
      x + w > width ||
      y + h > height
    )
      throw new Error("Invalid mask rectangle");
    bits.write(0, 1);
    bits.write(5, 5); // MoveTo 和 FillStyle1，使用已有的纯色填充。
    const count = signedBits([x * 20, y * 20]);
    bits.write(count, 5);
    bits.write(x * 20, count);
    bits.write(y * 20, count);
    bits.write(1, 1);
    for (const [dx, dy] of [
      [w * 20, 0],
      [0, h * 20],
      [-w * 20, 0],
      [0, -h * 20],
    ]) {
      const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 60000);
      let previous = 0;
      for (let step = 1; step <= steps; step++) {
        const target = Math.round(((dx || dy) * step) / steps);
        const delta = target - previous;
        previous = target;
        const edgeBits = Math.max(2, signedBits([delta]));
        bits.write(1, 1);
        bits.write(1, 1);
        bits.write(edgeBits - 2, 4);
        bits.write(0, 1);
        bits.write(dx === 0 ? 1 : 0, 1);
        bits.write(delta, edgeBits);
      }
    }
  }
  bits.write(0, 6);
  return {
    code: 32,
    data: Buffer.concat([
      u16(id),
      rect([0, width * 20, 0, height * 20]),
      Buffer.from([1, 0, 255, 255, 255, 255, 0]),
      bits.bytes(),
    ]),
  };
}

export function placeMask(
  id: number,
  depth: number,
  clipDepth: number,
  transform: Matrix,
): Tag {
  if (
    !Number.isInteger(depth) ||
    !Number.isInteger(clipDepth) ||
    depth < 1 ||
    clipDepth <= depth ||
    clipDepth > 65535
  ) {
    throw new Error("Invalid mask depth range");
  }
  return {
    code: 26,
    data: Buffer.concat([
      Buffer.from([0x46]),
      u16(depth),
      u16(id),
      matrix(transform),
      u16(clipDepth),
    ]),
  };
}

export const showFrame = (): Tag => ({ code: 1, data: Buffer.alloc(0) });
export const end = (): Tag => ({ code: 0, data: Buffer.alloc(0) });
export const remove = (depth: number): Tag => ({ code: 28, data: u16(depth) });
export const label = (name: string): Tag => ({ code: 43, data: cstring(name) });
export function sprite(id: number, frames: Tag[][]): Tag {
  if (!frames.length || frames.length > 65535)
    throw new Error("Invalid sprite frame count");
  const tags = frames.flatMap((frame) => [...frame, showFrame()]);
  return {
    code: 39,
    data: Buffer.concat([
      u16(id),
      u16(frames.length),
      ...tags.map(encodeTag),
      encodeTag(end()),
    ]),
  };
}
