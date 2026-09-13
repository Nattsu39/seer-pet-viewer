import { unzipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildPngSequenceEntryName,
  buildPngSequenceFilename,
  exportPngSequence,
  zipPngSequence,
} from "./png-sequence.js";
import type { FrameCaptureSource } from "./types.js";

afterEach(() => vi.unstubAllGlobals());

interface CentralEntry {
  name: string;
  method: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
}

/** 独立解析 zip 中央目录，不依赖 fflate 的读取侧 */
function readCentralDirectory(zip: Uint8Array): CentralEntry[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("找不到 EOCD");

  const count = view.getUint16(eocd + 10, true);
  const entries: CentralEntry[] = [];
  let offset = view.getUint32(eocd + 16, true);
  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error(`中央目录头损坏 @${offset}`);
    }
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    entries.push({
      method: view.getUint16(offset + 10, true),
      crc32: view.getUint32(offset + 16, true),
      compressedSize: view.getUint32(offset + 20, true),
      uncompressedSize: view.getUint32(offset + 24, true),
      name: new TextDecoder().decode(
        zip.subarray(offset + 46, offset + 46 + nameLen),
      ),
    });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

describe("png-sequence filenames", () => {
  it("buildPngSequenceFilename sanitizes and appends _frames.zip", () => {
    expect(buildPngSequenceFilename(4911, "standby")).toBe(
      "4911_standby_frames.zip",
    );
    expect(buildPngSequenceFilename(123, "stand by!")).toBe(
      "123_stand_by__frames.zip",
    );
  });

  it("entry names are 1-based, zero-padded to at least 4 digits", () => {
    expect(buildPngSequenceEntryName(4911, "standby", 0, 5)).toBe(
      "4911_standby_0001.png",
    );
    expect(buildPngSequenceEntryName(4911, "standby", 26, 100)).toBe(
      "4911_standby_0027.png",
    );
    expect(buildPngSequenceEntryName(4911, "standby", 999, 1000)).toBe(
      "4911_standby_1000.png",
    );
  });

  it("padding widens when frame count exceeds four digits", () => {
    expect(buildPngSequenceEntryName(4911, "standby", 0, 12000)).toBe(
      "4911_standby_00001.png",
    );
    expect(buildPngSequenceEntryName(4911, "standby", 9999, 12000)).toBe(
      "4911_standby_10000.png",
    );
    expect(buildPngSequenceEntryName(4911, "attack", 3, 12000) <
      buildPngSequenceEntryName(4911, "attack", 10234, 12000)).toBe(true);
  });
});

describe("zipPngSequence", () => {
  it("stores entries uncompressed in insertion order with correct CRC", () => {
    const png1 = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    const check = new TextEncoder().encode("123456789");
    const zip = zipPngSequence([
      { name: "4911_standby_0001.png", data: png1 },
      { name: "4911_standby_0002.png", data: check },
    ]);

    const entries = readCentralDirectory(zip);
    expect(entries.map((e) => e.name)).toEqual([
      "4911_standby_0001.png",
      "4911_standby_0002.png",
    ]);
    for (const entry of entries) {
      expect(entry.method).toBe(0);
      expect(entry.compressedSize).toBe(entry.uncompressedSize);
    }
    expect(entries[0]!.uncompressedSize).toBe(png1.length);
    // CRC-32/ISO-HDLC 标准校验值，独立于 fflate 验证 CRC 正确性
    expect(entries[1]!.crc32).toBe(0xcbf43926);
  });

  it("round-trips entry bytes through unzipSync", () => {
    const a = Uint8Array.from([1, 2, 3, 250, 0, 99]);
    const b = Uint8Array.from([42]);
    const zip = zipPngSequence([
      { name: "x_0001.png", data: a },
      { name: "x_0002.png", data: b },
    ]);
    const out = unzipSync(zip);
    expect(Array.from(out["x_0001.png"]!)).toEqual(Array.from(a));
    expect(Array.from(out["x_0002.png"]!)).toEqual(Array.from(b));
  });
});

describe("exportPngSequence streaming", () => {
  function mockCanvas(encode: () => Promise<Blob>) {
    const canvases: Array<{ width: number; height: number }> = [];
    vi.stubGlobal("ImageData", class { constructor(..._args: unknown[]) {} });
    vi.stubGlobal("OffscreenCanvas", class {
      constructor(public width: number, public height: number) { canvases.push(this); }
      getContext() { return { putImageData: vi.fn() }; }
      convertToBlob = encode;
    });
    return canvases;
  }

  it("encodes each frame before requesting the next and produces a valid store ZIP", async () => {
    const encoded = [new Uint8Array([137, 80, 78, 71]), new TextEncoder().encode("123456789"), new Uint8Array([42])];
    const events: string[] = [];
    let index = 0;
    const canvases = mockCanvas(async () => {
      events.push(`encode ${index}`);
      return new Blob([encoded[index++]!]);
    });
    const source: FrameCaptureSource = {
      getSequenceFrameCount: () => encoded.length,
      getExportFps: () => 24,
      async *captureFrames() {
        for (let i = 0; i < encoded.length; i++) {
          events.push(`capture ${i}`);
          yield { index: i, width: 2, height: 2, pixels: new Uint8Array(16) };
        }
      },
    };
    const blob = await exportPngSequence(source, { petId: 4911, sequence: "attack", scale: 1, background: "transparent" });
    const zip = new Uint8Array(await blob.arrayBuffer());
    const entries = readCentralDirectory(zip);
    const names = ["4911_attack_0001.png", "4911_attack_0002.png", "4911_attack_0003.png"];
    expect(events).toEqual(["capture 0", "encode 0", "capture 1", "encode 1", "capture 2", "encode 2"]);
    expect(blob.type).toBe("application/zip");
    expect(entries.map((e) => e.name)).toEqual(names);
    for (const [i, entry] of entries.entries()) {
      expect(entry.method).toBe(0);
      expect(entry.compressedSize).toBe(encoded[i]!.length);
      expect(entry.uncompressedSize).toBe(encoded[i]!.length);
    }
    expect(entries[1]!.crc32).toBe(0xcbf43926);
    expect(unzipSync(zip)).toEqual(Object.fromEntries(names.map((name, i) => [name, encoded[i]])));
    expect(canvases).toHaveLength(1);
    expect(canvases[0]).toMatchObject({ width: 0, height: 0 });
  });

  it("closes capture and releases the encoding canvas on failure", async () => {
    const canvases = mockCanvas(async () => { throw new Error("encoding failed"); });
    const closeCapture = vi.fn();
    const source: FrameCaptureSource = {
      getSequenceFrameCount: () => 2,
      getExportFps: () => 24,
      async *captureFrames() {
        try {
          yield { index: 0, width: 2, height: 2, pixels: new Uint8Array(16) };
        } finally {
          closeCapture();
        }
      },
    };
    await expect(exportPngSequence(source, { petId: 4911, sequence: "attack", scale: 1, background: "transparent" }))
      .rejects.toThrow("已完成 0/2 帧）: encoding failed");
    expect(closeCapture).toHaveBeenCalledOnce();
    expect(canvases[0]).toMatchObject({ width: 0, height: 0 });
  });
});
