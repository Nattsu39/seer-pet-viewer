import { MAX_EXPORT_SIDE } from "./export-dimensions.js";
import { createExportWorkerClient, type ExportWorkerClient } from "./export-worker-client.js";
import { copyRgbaPixels } from "./pixels.js";
import type {
  CapturedFrame,
  ExportOptions,
  ExportProgress,
  FrameCaptureSource,
} from "./types.js";

const FORMAT_LABEL: Record<ExportOptions["format"], string> = {
  gif: "GIF",
  webp: "WebP",
};

function mimeType(format: ExportOptions["format"]): string {
  return format === "gif" ? "image/gif" : "image/webp";
}

/** 零拷贝构造 Blob；编码器返回 subarray 时退回紧凑复制 */
function blobFromBytes(bytes: Uint8Array, format: ExportOptions["format"]): Blob {
  const part =
    bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
      ? (bytes.buffer as ArrayBuffer)
      : new Uint8Array(bytes);
  return new Blob([part], { type: mimeType(format) });
}

/** 校验捕获帧尺寸与像素长度；返回可安全转移的紧凑像素（通常零拷贝） */
function takeFramePixels(
  frame: CapturedFrame,
  width: number,
  height: number,
): Uint8Array {
  if (frame.width !== width || frame.height !== height) {
    throw new Error("导出帧尺寸不一致");
  }
  const expected = width * height * 4;
  if (frame.pixels.length < expected) {
    throw new Error(
      `像素数据不足: 需要 ${expected} 字节，实际 ${frame.pixels.length} 字节 (${width}×${height})`,
    );
  }
  const { pixels } = frame;
  if (
    pixels.byteOffset === 0 &&
    pixels.buffer.byteLength === expected &&
    pixels.length === expected
  ) {
    return pixels;
  }
  // 挂在共享大 buffer 上的视图：复制出紧凑副本以便转移/编码
  return copyRgbaPixels(pixels, width, height);
}

function validateCanvasSize(width: number, height: number) {
  if (width <= 0 || height <= 0 || width > MAX_EXPORT_SIDE || height > MAX_EXPORT_SIDE) {
    throw new Error(
      `导出尺寸过大 (${width}×${height})，请降低缩放倍数；最长边上限 ${MAX_EXPORT_SIDE}px`,
    );
  }
}

/**
 * 捕获全部帧（边捕获边转移给编码 worker，主线程不持有全帧副本），
 * 随后编码为 GIF/WebP 动画。无 worker 环境时回退到主线程内联编码。
 */
export async function exportAnimation(
  source: FrameCaptureSource,
  options: ExportOptions,
  onProgress?: (progress: ExportProgress) => void,
): Promise<Blob> {
  const frameCount = source.getSequenceFrameCount(options.sequence);
  if (frameCount <= 0) {
    throw new Error("当前序列没有可导出的帧");
  }

  const fps = options.fps ?? source.getExportFps();
  const label = FORMAT_LABEL[options.format];
  const client = createExportWorkerClient();

  if (client) {
    try {
      return await exportViaWorker(client, source, options, fps, onProgress, label);
    } finally {
      client.dispose();
    }
  }
  return exportInline(source, options, fps, onProgress, label);
}

async function exportViaWorker(
  client: ExportWorkerClient,
  source: FrameCaptureSource,
  options: ExportOptions,
  fps: number,
  onProgress?: (progress: ExportProgress) => void,
  label = "导出",
): Promise<Blob> {
  const total = source.getSequenceFrameCount(options.sequence);
  let width = 0;
  let height = 0;
  let captured = 0;

  try {
    for await (const frame of source.captureFrames(options)) {
      if (captured === 0) {
        width = frame.width;
        height = frame.height;
        validateCanvasSize(width, height);
        client.begin({
          format: options.format,
          width,
          height,
          fps,
          background: options.background,
        });
      }
      const pixels = takeFramePixels(frame, width, height);
      client.sendFrame(pixels);
      captured++;
      onProgress?.({ phase: "capture", done: captured, total });
    }
  } catch (e) {
    throw new Error(
      `${label} 捕获失败（已完成 ${captured}/${total} 帧）: ${e instanceof Error ? e.message : e}`,
      { cause: e },
    );
  }

  if (captured === 0) {
    throw new Error("未能捕获任何帧");
  }

  const bytes = await client.finish(onProgress);
  return blobFromBytes(bytes, options.format);
}

/** 无 worker 环境的回退路径：直接复用捕获 buffer（不复制），编码逐帧释放 */
async function exportInline(
  source: FrameCaptureSource,
  options: ExportOptions,
  fps: number,
  onProgress?: (progress: ExportProgress) => void,
  label = "导出",
): Promise<Blob> {
  let width = 0;
  let height = 0;
  let captured = 0;
  const frames: Array<CapturedFrame | undefined> = [];
  const total = source.getSequenceFrameCount(options.sequence);

  try {
    for await (const frame of source.captureFrames(options)) {
      if (captured === 0) {
        width = frame.width;
        height = frame.height;
        validateCanvasSize(width, height);
      }
      frames.push({ ...frame, pixels: takeFramePixels(frame, width, height) });
      captured++;
      onProgress?.({ phase: "capture", done: captured, total });
    }
  } catch (e) {
    throw new Error(
      `${label} 捕获失败（已完成 ${captured}/${total} 帧）: ${e instanceof Error ? e.message : e}`,
      { cause: e },
    );
  }

  if (!frames.length) {
    throw new Error("未能捕获任何帧");
  }

  onProgress?.({ phase: "encode", done: 0, total: frames.length });
  const bytes =
    options.format === "gif"
      ? (await import("./gif-encode.js")).encodeGifFrames(frames, {
          width,
          height,
          fps,
          loop: true,
          background: options.background,
          onFrameDone: (done, total) =>
            onProgress?.({ phase: "encode", done, total }),
        })
      : await (await import("./webp-encode.js")).encodeAnimatedWebp(frames, {
          width,
          height,
          fps,
          loop: true,
        });
  return blobFromBytes(bytes, options.format);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function buildExportFilename(
  petId: number,
  sequence: string,
  format: ExportOptions["format"],
): string {
  const safeSeq = sequence.replace(/[^\w-]+/g, "_");
  return `${petId}_${safeSeq}.${format}`;
}
