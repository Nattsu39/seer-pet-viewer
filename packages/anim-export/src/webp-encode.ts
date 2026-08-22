import {
  encodeAnimationWasm,
  type WebPAnimationFrameInput,
} from "./wasm-webp-loader.js";
import type { CapturedFrame } from "./types.js";

export interface WebpEncodeOptions {
  width: number;
  height: number;
  fps: number;
  loop: boolean;
  quality?: number;
}

/**
 * 注意：本函数会消费 frames（逐帧置空、释放像素引用），调用方在调用后不得再使用。
 * 像素不复制；push_back 进 WASM 堆后由 loader 逐帧释放 JS 侧引用。
 */
export async function encodeAnimatedWebp(
  frames: Array<CapturedFrame | undefined>,
  options: WebpEncodeOptions,
): Promise<Uint8Array> {
  const { width, height, fps, quality = 88 } = options;
  const delayMs = Math.max(1, Math.round(1000 / fps));
  const pixelBytes = width * height * 4;
  const hasAlpha = frames.some((frame) => {
    if (!frame) return false;
    if (frame.width !== width || frame.height !== height) {
      throw new Error("导出帧尺寸不一致");
    }
    for (let i = 3; i < pixelBytes; i += 4) {
      if (frame.pixels[i]! < 255) return true;
    }
    return false;
  });

  const webpFrames: WebPAnimationFrameInput[] = [];
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    frames[i] = undefined;
    if (!frame) continue;
    webpFrames.push({
      data: frame.pixels,
      duration: delayMs,
      config: { lossless: 0, quality },
    });
  }

  const bytes = await encodeAnimationWasm(width, height, hasAlpha, webpFrames);
  if (!bytes) {
    throw new Error("WebP 编码失败");
  }
  return bytes;
}
