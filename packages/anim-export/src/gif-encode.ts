import { GIFEncoder } from "gifenc";
import { buildGlobalGifPalette } from "./gif-palette.js";
import { applyPalette, prequantizeForGif } from "./gifenc-safe.js";
import type { CapturedFrame, ExportBackground } from "./types.js";

export interface GifEncodeOptions {
  width: number;
  height: number;
  fps: number;
  loop: boolean;
  background: ExportBackground;
  /** 由全动画帧子采样构建的全局调色盘；未提供时回退到首帧量化 */
  palette?: number[][];
}

function findTransparentPaletteIndex(palette: number[][]): number {
  return palette.findIndex((c) => c.length >= 4 && (c[3] ?? 255) < 128);
}

export interface GifStreamEncoder {
  addFrame(pixels: Uint8Array, frameIndex: number): void;
  finish(): Uint8Array;
}

export function createGifStreamEncoder(
  options: GifEncodeOptions,
): GifStreamEncoder {
  const { width, height, fps, loop, background } = options;
  const delayMs = Math.max(1, Math.round(1000 / fps));
  const useAlpha = background === "transparent";
  const pixelFormat = useAlpha ? "rgba4444" : "rgb565";

  const gif = GIFEncoder();
  const palette = options.palette;
  if (!palette?.length) {
    throw new Error("GIF 编码需要全局调色盘");
  }
  const transparentIndex = useAlpha ? findTransparentPaletteIndex(palette) : -1;

  return {
    addFrame(pixels: Uint8Array, frameIndex: number) {
      const stabilized = prequantizeForGif(
        pixels,
        width,
        height,
        pixelFormat,
        useAlpha,
      );
      const index = applyPalette(
        stabilized,
        width,
        height,
        palette,
        pixelFormat,
      );
      const frameOptions: Parameters<typeof gif.writeFrame>[3] = {
        palette,
        delay: delayMs,
        dispose: 2,
        ...(frameIndex === 0 && loop ? { repeat: 0 } : {}),
      };
      if (useAlpha && transparentIndex >= 0) {
        frameOptions.transparent = true;
        frameOptions.transparentIndex = transparentIndex;
      }
      gif.writeFrame(index, width, height, frameOptions);
    },
    finish() {
      gif.finish();
      return gif.bytes();
    },
  };
}

export function encodeGif(
  frames: CapturedFrame[],
  options: GifEncodeOptions,
): Uint8Array {
  const { width, height } = options;
  const encoder = createGifStreamEncoder(options);
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]!;
    if (frame.width !== width || frame.height !== height) {
      throw new Error("导出帧尺寸不一致");
    }
    encoder.addFrame(frame.pixels, i);
  }
  return encoder.finish();
}

/**
 * 全流程 GIF 编码：全局调色盘 + 逐帧写入。
 * 编码完一帧立即把 frames[i] 置空释放引用，避免全帧像素与编码输出长期共存。
 */
export function encodeGifFrames(
  frames: Array<{ pixels: Uint8Array } | undefined>,
  options: GifEncodeOptions & {
    onFrameDone?: (done: number, total: number) => void;
  },
): Uint8Array {
  const { width, height, background, onFrameDone } = options;
  const pending = frames.filter(
    (f): f is { pixels: Uint8Array } => f !== undefined,
  );
  if (!pending.length) {
    throw new Error("未能捕获任何帧");
  }
  const palette = buildGlobalGifPalette(
    pending.map((f) => f.pixels),
    width,
    height,
    background,
  );
  const encoder = createGifStreamEncoder({ ...options, palette });
  const total = frames.length;
  for (let i = 0; i < total; i++) {
    const frame = frames[i];
    if (frame) {
      encoder.addFrame(frame.pixels, i);
    }
    frames[i] = undefined;
    onFrameDone?.(i + 1, total);
  }
  return encoder.finish();
}
