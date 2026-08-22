import { zipSync } from "fflate";
import {
  blobFromBytes,
  sanitizeSequenceName,
  takeFramePixels,
  validateCanvasSize,
} from "./export.js";
import type {
  ExportProgress,
  FrameCaptureSource,
  PngSequenceOptions,
} from "./types.js";

const ZIP_MIME = "application/zip";

/** 复用同一画布逐帧调用浏览器原生 PNG 编码器 */
class PngFrameEncoder {
  private offscreen: OffscreenCanvas | null = null;
  private canvas: HTMLCanvasElement | null = null;

  async encode(
    pixels: Uint8Array,
    width: number,
    height: number,
  ): Promise<Uint8Array> {
    const data = new Uint8ClampedArray(
      // 捕获管线产出的像素挂在普通 ArrayBuffer 上，无 SharedArrayBuffer 场景
      pixels.buffer as ArrayBuffer,
      pixels.byteOffset,
      width * height * 4,
    );
    let blob: Blob;
    if (typeof OffscreenCanvas !== "undefined") {
      if (!this.offscreen) {
        this.offscreen = new OffscreenCanvas(width, height);
      } else {
        this.offscreen.width = width;
        this.offscreen.height = height;
      }
      const ctx = this.offscreen.getContext("2d");
      if (!ctx) throw new Error("无法创建 2D 上下文");
      ctx.putImageData(new ImageData(data, width, height), 0, 0);
      blob = await this.offscreen.convertToBlob({ type: "image/png" });
    } else {
      if (!this.canvas) this.canvas = document.createElement("canvas");
      this.canvas.width = width;
      this.canvas.height = height;
      const ctx = this.canvas.getContext("2d");
      if (!ctx) throw new Error("无法创建 2D 上下文");
      ctx.putImageData(new ImageData(data, width, height), 0, 0);
      const out = await new Promise<Blob | null>((resolve) =>
        this.canvas!.toBlob(resolve, "image/png"),
      );
      if (!out) throw new Error("PNG 编码失败");
      blob = out;
    }
    return new Uint8Array(await blob.arrayBuffer());
  }
}

/** PNG 自带 deflate 压缩，zip 内 store 模式直存避免二次压缩 */
export function zipPngSequence(
  entries: ReadonlyArray<{ name: string; data: Uint8Array }>,
): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const { name, data } of entries) {
    files[name] = data;
  }
  return zipSync(files, { level: 0 });
}

export function buildPngSequenceFilename(
  petId: number,
  sequence: string,
): string {
  return `${petId}_${sanitizeSequenceName(sequence)}_frames.zip`;
}

/** 帧号 1 起步，补零宽度至少 4 位，帧数过万时加宽保证字典序 */
export function buildPngSequenceEntryName(
  petId: number,
  sequence: string,
  index: number,
  total: number,
): string {
  const width = Math.max(4, String(total).length);
  const frame = String(index + 1).padStart(width, "0");
  return `${petId}_${sanitizeSequenceName(sequence)}_${frame}.png`;
}

/**
 * 把整段序列逐帧导出为对齐的 PNG（共用捕获管线的参考布局与全序列紧裁剪），
 * 主线程边捕获边编码、只保留压缩后的 PNG 字节，最后以 store 模式打包为 zip。
 */
export async function exportPngSequence(
  source: FrameCaptureSource,
  options: PngSequenceOptions,
  onProgress?: (progress: ExportProgress) => void,
): Promise<Blob> {
  const total = source.getSequenceFrameCount(options.sequence);
  if (total <= 0) {
    throw new Error("当前序列没有可导出的帧");
  }

  const encoder = new PngFrameEncoder();
  const entries: Array<{ name: string; data: Uint8Array }> = [];
  let width = 0;
  let height = 0;
  let captured = 0;

  try {
    for await (const frame of source.captureFrames(options)) {
      if (captured === 0) {
        width = frame.width;
        height = frame.height;
        validateCanvasSize(width, height);
      }
      const pixels = takeFramePixels(frame, width, height);
      const data = await encoder.encode(pixels, width, height);
      entries.push({
        name: buildPngSequenceEntryName(
          options.petId,
          options.sequence,
          captured,
          total,
        ),
        data,
      });
      captured++;
      onProgress?.({ phase: "capture", done: captured, total });
    }
  } catch (e) {
    throw new Error(
      `PNG 序列帧捕获失败（已完成 ${captured}/${total} 帧）: ${e instanceof Error ? e.message : e}`,
      { cause: e },
    );
  }

  if (entries.length === 0) {
    throw new Error("未能捕获任何帧");
  }

  onProgress?.({ phase: "encode", done: 0, total: 1 });
  const bytes = zipPngSequence(entries);
  onProgress?.({ phase: "encode", done: 1, total: 1 });
  return blobFromBytes(bytes, ZIP_MIME);
}
