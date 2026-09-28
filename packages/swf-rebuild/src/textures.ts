import { Buffer } from "buffer";
import type { TextureScale } from "./types.js";

export function validateTextureScale(value: number): TextureScale {
  if (value !== 1 && value !== 0.5 && value !== 0.25) {
    throw new Error("Texture scale must be 1, 0.5 or 0.25");
  }
  return value;
}

/** 对预乘通道取平均，避免透明像素的 RGB 渗入边缘。 */
export function downsampleArgb(
  pixels: Buffer,
  width: number,
  height: number,
  scale: TextureScale,
): Buffer {
  validateTextureScale(scale);
  if (pixels.length !== width * height * 4)
    throw new Error("Bitmap size mismatch");
  if (scale === 1) return pixels;
  const blockSize = 1 / scale;
  const nextWidth = Math.ceil(width * scale);
  const nextHeight = Math.ceil(height * scale);
  const resized = Buffer.alloc(nextWidth * nextHeight * 4);
  for (let y = 0; y < nextHeight; y++) {
    for (let x = 0; x < nextWidth; x++) {
      const xStart = x * blockSize,
        yStart = y * blockSize;
      const xEnd = Math.min(xStart + blockSize, width);
      const yEnd = Math.min(yStart + blockSize, height);
      // 纹理尺寸为奇数时，边缘不足一个块的行或列仍会保留。
      const samples = (xEnd - xStart) * (yEnd - yStart);
      for (let channel = 0; channel < 4; channel++) {
        let total = 0;
        for (let sy = yStart; sy < yEnd; sy++) {
          for (let sx = xStart; sx < xEnd; sx++)
            total += pixels[(sy * width + sx) * 4 + channel];
        }
        resized[(y * nextWidth + x) * 4 + channel] = Math.round(
          total / samples,
        );
      }
    }
  }
  return resized;
}
