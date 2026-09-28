import { Buffer } from "buffer";
/** SWF 和 ABC 共用的位操作基础工具，按字节对齐并采用高位优先顺序。 */
export class Reader {
  position = 0;
  constructor(readonly data: Buffer) {}

  take(length: number): Buffer {
    if (
      !Number.isInteger(length) ||
      length < 0 ||
      this.position + length > this.data.length
    ) {
      throw new Error(`Truncated binary record at byte ${this.position}`);
    }
    const result = this.data.slice(this.position, this.position + length);
    this.position += length;
    return result;
  }
  u8(): number {
    return this.take(1)[0];
  }
  u16(): number {
    return this.take(2).readUInt16LE(0);
  }
  u32(): number {
    return this.take(4).readUInt32LE(0);
  }
  encoded(): number {
    let value = 0;
    for (let shift = 0; shift <= 28; shift += 7) {
      const byte = this.u8();
      if (shift === 28 && byte > 15) throw new Error("Invalid encoded integer");
      value += (byte & 127) * 2 ** shift;
      if (!(byte & 128)) return value;
    }
    throw new Error("Invalid encoded integer");
  }
  string(): string {
    const end = this.data.indexOf(0, this.position);
    if (end < 0) throw new Error("Unterminated SWF string");
    return this.take(end - this.position + 1)
      .slice(0, -1)
      .toString("utf8");
  }
}

export class BitReader {
  bit = 0;
  constructor(readonly data: Buffer) {}
  read(count: number, signed = false): number {
    if (count < 0 || this.bit + count > this.data.length * 8)
      throw new Error("Truncated bit record");
    let value = 0;
    for (let i = 0; i < count; i++, this.bit++) {
      value =
        value * 2 + ((this.data[this.bit >> 3] >> (7 - (this.bit & 7))) & 1);
    }
    return signed && count && value >= 2 ** (count - 1)
      ? value - 2 ** count
      : value;
  }
  get bytes(): number {
    return Math.ceil(this.bit / 8);
  }
}

export function signedBits(values: number[]): number {
  if (values.some((value) => !Number.isSafeInteger(value)))
    throw new Error("Expected finite integer bit fields");
  let count = 1;
  while (
    values.some(
      (value) => value < -(2 ** (count - 1)) || value >= 2 ** (count - 1),
    )
  )
    count++;
  if (count > 31) {
    throw new Error("Signed SWF field exceeds its supported range");
  }
  return count;
}

export class BitWriter {
  private values: number[] = [];
  private bit = 0;
  write(value: number, count: number): void {
    if (!Number.isInteger(value) || count < 0 || count > 31)
      throw new Error("Invalid bit field");
    if (value < 0) value += 2 ** count;
    if (value < 0 || value >= 2 ** count) throw new Error("Bit field overflow");
    for (let i = count - 1; i >= 0; i--, this.bit++) {
      const index = this.bit >> 3;
      this.values[index] =
        (this.values[index] ?? 0) |
        ((Math.floor(value / 2 ** i) % 2) << (7 - (this.bit & 7)));
    }
  }
  bytes(): Buffer {
    return Buffer.from(this.values);
  }
}

export function u16(value: number): Buffer {
  const bytes = Buffer.alloc(2);
  bytes.writeUInt16LE(value, 0);
  return bytes;
}
export function u32(value: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value, 0);
  return bytes;
}
export function encodedU30(value: number): Buffer {
  if (!Number.isInteger(value) || value < 0 || value > 0x3fffffff)
    throw new Error("U30 overflow");
  const bytes: number[] = [];
  do {
    const byte = value & 127;
    value = Math.floor(value / 128);
    bytes.push(byte | (value ? 128 : 0));
  } while (value);
  return Buffer.from(bytes);
}
export function cstring(value: string): Buffer {
  if (value.includes("\0")) throw new Error("SWF strings cannot contain NUL");
  return Buffer.from(`${value}\0`, "utf8");
}
