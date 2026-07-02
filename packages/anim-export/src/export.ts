import { createGifStreamEncoder } from "./gif-encode.js";
import { buildGlobalGifPalette } from "./gif-palette.js";
import { copyRgbaPixels } from "./pixels.js";
import { encodeAnimatedWebp } from "./webp-encode.js";
import type {
  CapturedFrame,
  ExportOptions,
  ExportProgress,
  FrameCaptureSource,
} from "./types.js";

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
  let width = 0;
  let height = 0;
  let captured = 0;

  if (options.format === "gif") {
    const framePixels: Uint8Array[] = [];

    try {
      for await (const frame of source.captureFrames(options)) {
        const pixels = copyRgbaPixels(frame.pixels, frame.width, frame.height);
        if (captured === 0) {
          width = frame.width;
          height = frame.height;
        } else if (frame.width !== width || frame.height !== height) {
          throw new Error("导出帧尺寸不一致");
        }

        framePixels.push(pixels);
        captured++;
        onProgress?.({ phase: "capture", done: captured, total: frameCount });
      }
    } catch (e) {
      throw new Error(
        `GIF 捕获失败（已完成 ${captured}/${frameCount} 帧）: ${e instanceof Error ? e.message : e}`,
        { cause: e },
      );
    }

    if (framePixels.length === 0) {
      throw new Error("未能捕获任何帧");
    }

    onProgress?.({ phase: "encode", done: 0, total: framePixels.length });
    let palette: number[][];
    try {
      palette = buildGlobalGifPalette(
        framePixels,
        width,
        height,
        options.background,
      );
    } catch (e) {
      throw new Error(
        `GIF 调色盘构建失败: ${e instanceof Error ? e.message : e}`,
        { cause: e },
      );
    }
    for (let i = 0; i < palette.length; i++) {
      const color = palette[i];
      if (!color || color.length < 3) {
        throw new Error(`GIF 调色盘第 ${i} 项无效: ${String(color)}`);
      }
    }
    const gifEncoder = createGifStreamEncoder({
      width,
      height,
      fps,
      loop: true,
      background: options.background,
      palette,
    });
    for (let i = 0; i < framePixels.length; i++) {
      try {
        gifEncoder.addFrame(framePixels[i]!, i);
      } catch (e) {
        throw new Error(
          `GIF 编码第 ${i + 1}/${framePixels.length} 帧失败: ${e instanceof Error ? e.message : e}`,
          { cause: e },
        );
      }
      onProgress?.({
        phase: "encode",
        done: i + 1,
        total: framePixels.length,
      });
    }
    const bytes = gifEncoder.finish();
    return new Blob([new Uint8Array(bytes)], { type: "image/gif" });
  }

  const webpFrames: CapturedFrame[] = [];
  for await (const frame of source.captureFrames(options)) {
    const pixels = copyRgbaPixels(frame.pixels, frame.width, frame.height);
    webpFrames.push({ ...frame, pixels });
    width = frame.width;
    height = frame.height;
    captured++;
    onProgress?.({ phase: "capture", done: captured, total: frameCount });
  }

  if (webpFrames.length === 0) {
    throw new Error("未能捕获任何帧");
  }

  onProgress?.({ phase: "encode", done: 0, total: webpFrames.length });
  const bytes = await encodeAnimatedWebp(webpFrames, {
    width,
    height,
    fps,
    loop: true,
  });
  onProgress?.({
    phase: "encode",
    done: webpFrames.length,
    total: webpFrames.length,
  });

  return new Blob([new Uint8Array(bytes)], { type: "image/webp" });
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
