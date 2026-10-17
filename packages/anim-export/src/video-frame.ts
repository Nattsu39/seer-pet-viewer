import { takeFramePixels } from "./export.js";
import type { CapturedFrame } from "./types.js";

export function compositeOpaqueVideoPixels(
  frame: CapturedFrame,
  width: number,
  height: number,
  background: number,
): Uint8Array<ArrayBuffer> {
  const source = takeFramePixels(frame, frame.width, frame.height);
  const pixels = new Uint8Array(width * height * 4);
  const red = (background >> 16) & 255;
  const green = (background >> 8) & 255;
  const blue = background & 255;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels[offset] = red;
    pixels[offset + 1] = green;
    pixels[offset + 2] = blue;
    pixels[offset + 3] = 255;
  }
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) {
      const input = (y * frame.width + x) * 4;
      const output = (y * width + x) * 4;
      const alpha = source[input + 3]! / 255;
      pixels[output] = Math.round(source[input]! * alpha + red * (1 - alpha));
      pixels[output + 1] = Math.round(
        source[input + 1]! * alpha + green * (1 - alpha),
      );
      pixels[output + 2] = Math.round(
        source[input + 2]! * alpha + blue * (1 - alpha),
      );
    }
  }
  return pixels;
}
