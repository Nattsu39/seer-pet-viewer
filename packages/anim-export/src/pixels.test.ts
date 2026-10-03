import { describe, expect, it } from "vitest";
import { unpremultiplyPixels } from "./pixels.js";

describe("unpremultiplyPixels", () => {
  it.each([Uint8Array, Uint8ClampedArray])(
    "converts %s in place while preserving alpha and clamping RGB",
    (PixelArray) => {
      const pixels = new PixelArray([
        20, 40, 60, 0, 40, 20, 10, 128, 200, 120, 30, 64, 20, 40, 60, 255,
      ]);

      unpremultiplyPixels(pixels);

      expect(Array.from(pixels)).toEqual([
        0, 0, 0, 0, 80, 40, 20, 128, 255, 255, 120, 64, 20, 40, 60, 255,
      ]);
    },
  );
});
