import {
  cropRgbaPixels,
  findSignificantAlphaBounds,
  unionPixelRects,
  type PixelRect,
} from "./alpha-bounds.js";
import { TIGHT_CROP_PADDING, type RgbaFrame } from "./export-dimensions.js";
import type { CapturedFrame } from "./types.js";

/**
 * 固定视口逐帧交付；紧裁剪先扫描边界，再重渲染逐帧交付。
 * 捕获器只持有当前帧，内存不随序列帧数增长。消费者需及时编码/释放。
 */
export async function* streamCapturedFrames(
  frameCount: number,
  renderFrame: (index: number) => RgbaFrame,
  tightCrop: boolean,
): AsyncGenerator<CapturedFrame> {
  let union: PixelRect | null = null;
  const measureFrame = (index: number) => {
    const frame = renderFrame(index);
    union = unionPixelRects(
      union,
      findSignificantAlphaBounds(frame.pixels, frame.width, frame.height),
    );
  };
  if (tightCrop) {
    for (let i = 0; i < frameCount; i++) {
      measureFrame(i);
      await nextFrame();
    }
  }

  const captureFrame = (index: number): CapturedFrame => {
    const frame = renderFrame(index);
    if (!union) return { index, ...frame };
    const rect = {
      minX: Math.max(0, union.minX - TIGHT_CROP_PADDING),
      minY: Math.max(0, union.minY - TIGHT_CROP_PADDING),
      maxX: Math.min(frame.width - 1, union.maxX + TIGHT_CROP_PADDING),
      maxY: Math.min(frame.height - 1, union.maxY + TIGHT_CROP_PADDING),
    };
    return { index, ...cropRgbaPixels(frame.pixels, frame.width, frame.height, rect) };
  };
  for (let i = 0; i < frameCount; i++) {
    yield captureFrame(i);
    await nextFrame();
  }
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
