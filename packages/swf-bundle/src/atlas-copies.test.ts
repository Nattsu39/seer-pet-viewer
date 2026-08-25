import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssetType, loadAssetBundle } from "@arkntools/unity-js";
import {
  atlasPixelsToBitmap,
  bleedAtlasEdges,
  flipAtlasY,
  flipAtlasYInPlace,
  prepareAtlasRgba,
  rgbaToImageBitmap,
} from "./atlas.js";
import { parseBundleCore } from "./parse.js";

/**
 * 8192×8192 RGBA 图集单份为 256 MiB，因此这里测的是"内存契约"：
 * 图集处理函数不得再分配第二份整图 buffer。
 */

const root = resolve(import.meta.dirname, "../../..");
const bundlePath = resolve(root, "tools/.tmp-306/ppets_306.bundle");

/** 旧实现：整图 scratch + 多轮 pass，作为像素结果的独立参照 */
function bleedAtlasEdgesWithScratch(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  passes = 8,
  alphaThreshold = 8,
): void {
  const w = width;
  const h = height;
  const scratch = new Uint8ClampedArray(rgba.length);

  for (let pass = 0; pass < passes; pass++) {
    scratch.set(rgba);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (rgba[i + 3]! > alphaThreshold) continue;

        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
            const j = (ny * w + nx) * 4;
            if (rgba[j + 3]! > alphaThreshold) {
              r += rgba[j]!;
              g += rgba[j + 1]!;
              b += rgba[j + 2]!;
              n++;
            }
          }
        }
        if (n > 0) {
          scratch[i] = Math.round(r / n);
          scratch[i + 1] = Math.round(g / n);
          scratch[i + 2] = Math.round(b / n);
        }
      }
    }
    rgba.set(scratch);
  }
}

/** 旧实现：整图输出 buffer，作为翻转结果的独立参照 */
function flipAtlasYWithOutputBuffer(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba.length);
  const row = width * 4;
  for (let y = 0; y < height; y++) {
    out.set(rgba.subarray(y * row, y * row + row), (height - 1 - y) * row);
  }
  return out;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomAtlas(
  width: number,
  height: number,
  seed = 1,
): Uint8ClampedArray {
  const random = mulberry32(seed);
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = Math.floor(random() * 256);
    rgba[i + 1] = Math.floor(random() * 256);
    rgba[i + 2] = Math.floor(random() * 256);
    // 混合全透明、半透明和不透明像素，覆盖 bleed 的两个分支
    const roll = random();
    rgba[i + 3] = roll < 0.5 ? 0 : roll < 0.6 ? 4 : Math.floor(random() * 256);
  }
  return rgba;
}

/**
 * 记录被测代码新分配的 Uint8ClampedArray backing store 尺寸（视图不计入）。
 * atlas 处理链路上的整图副本都是 Uint8ClampedArray，因此这里能直接观察副本数量。
 */
function trackClampedAllocations(): {
  sizes: number[];
  restore: () => void;
} {
  const Real = globalThis.Uint8ClampedArray;
  const sizes: number[] = [];
  class Tracked extends Real {
    constructor(...args: ConstructorParameters<typeof Uint8ClampedArray>) {
      // @ts-expect-error 透传全部构造签名
      super(...args);
      const [source] = args;
      const isView =
        source instanceof ArrayBuffer ||
        (typeof SharedArrayBuffer !== "undefined" &&
          source instanceof SharedArrayBuffer);
      if (!isView) sizes.push(this.length);
    }
  }
  vi.stubGlobal("Uint8ClampedArray", Tracked);
  return {
    sizes,
    restore: () => {
      vi.stubGlobal("Uint8ClampedArray", Real);
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("flipAtlasYInPlace", () => {
  it("matches the output-buffer flip byte for byte", () => {
    const width = 7;
    const height = 5;
    const source = randomAtlas(width, height, 42);
    const expected = flipAtlasYWithOutputBuffer(source, width, height);

    const actual = flipAtlasYInPlace(source, width, height);

    expect(Array.from(actual)).toEqual(Array.from(expected));
    expect(actual).toBe(source);
  });

  it("flips odd and even row counts symmetrically", () => {
    for (const height of [1, 2, 3, 8]) {
      const width = 3;
      const source = randomAtlas(width, height, height);
      const expected = flipAtlasYWithOutputBuffer(source, width, height);
      expect(Array.from(flipAtlasYInPlace(source, width, height))).toEqual(
        Array.from(expected),
      );
    }
  });

  it("allocates at most one atlas row", () => {
    const width = 64;
    const height = 64;
    const rgba = randomAtlas(width, height, 7);
    const tracker = trackClampedAllocations();
    try {
      flipAtlasYInPlace(rgba, width, height);
    } finally {
      tracker.restore();
    }

    for (const size of tracker.sizes) {
      expect(size).toBeLessThanOrEqual(width * 4);
    }
  });
});

describe("bleedAtlasEdges", () => {
  it("matches the scratch-buffer implementation on mixed alpha data", () => {
    const width = 23;
    const height = 17;
    const expected = randomAtlas(width, height, 5);
    const actual = randomAtlas(width, height, 5);

    bleedAtlasEdgesWithScratch(expected, width, height, 2);
    bleedAtlasEdges(actual, width, height, 2);

    expect(Array.from(actual)).toEqual(Array.from(expected));
  });

  it("is idempotent across pass counts", () => {
    const width = 19;
    const height = 13;
    const once = randomAtlas(width, height, 9);
    const many = randomAtlas(width, height, 9);

    bleedAtlasEdges(once, width, height, 1);
    bleedAtlasEdges(many, width, height, 8);

    expect(Array.from(many)).toEqual(Array.from(once));
  });

  it("never allocates a second full-size buffer", () => {
    const width = 64;
    const height = 64;
    const rgba = randomAtlas(width, height, 11);
    const tracker = trackClampedAllocations();
    try {
      bleedAtlasEdges(rgba, width, height, 2);
    } finally {
      tracker.restore();
    }

    for (const size of tracker.sizes) {
      expect(size).toBeLessThan(rgba.length);
    }
  });
});

describe("prepareAtlasRgba", () => {
  it("never allocates a second full-size buffer", () => {
    const width = 48;
    const height = 32;
    const rgba = randomAtlas(width, height, 13);
    const tracker = trackClampedAllocations();
    try {
      prepareAtlasRgba(rgba, width, height);
    } finally {
      tracker.restore();
    }

    for (const size of tracker.sizes) {
      expect(size).toBeLessThan(rgba.length);
    }
  });
});

describe("rgbaToImageBitmap", () => {
  it("hands the caller buffer to ImageData without copying it", async () => {    const width = 4;
    const height = 2;
    const rgba = randomAtlas(width, height, 17);
    const seen: Uint8ClampedArray[] = [];

    vi.stubGlobal(
      "ImageData",
      class {
        data: Uint8ClampedArray;
        width: number;
        height: number;
        constructor(data: Uint8ClampedArray, w: number, h: number) {
          this.data = data;
          this.width = w;
          this.height = h;
          seen.push(data);
        }
      },
    );
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width, height, close: vi.fn() })),
    );

    await rgbaToImageBitmap(width, height, rgba);

    expect(seen).toHaveLength(1);
    expect(seen[0]!.buffer).toBe(rgba.buffer);
  });
});

describe("atlasPixelsToBitmap", () => {
  it("prepares and uploads the atlas without copying it", async () => {
    const width = 32;
    const height = 16;
    const rgba = randomAtlas(width, height, 19);
    const seen: Uint8ClampedArray[] = [];

    vi.stubGlobal(
      "ImageData",
      class {
        data: Uint8ClampedArray;
        width: number;
        height: number;
        constructor(data: Uint8ClampedArray, w: number, h: number) {
          this.data = data;
          this.width = w;
          this.height = h;
          seen.push(data);
        }
      },
    );
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width, height, close: vi.fn() })),
    );

    const tracker = trackClampedAllocations();
    try {
      await atlasPixelsToBitmap({ width, height, rgba });
    } finally {
      tracker.restore();
    }

    expect(seen).toHaveLength(1);
    expect(seen[0]!.buffer).toBe(rgba.buffer);
    for (const size of tracker.sizes) {
      expect(size).toBeLessThan(rgba.length);
    }
  });
});

describe("parseBundleCore atlas pixels", () => {
  const hasFixture = existsSync(bundlePath);

  it.skipIf(!hasFixture)(
    "allocates at most one full-size atlas buffer (strip decode output)",
    async () => {
      const buf = readFileSync(bundlePath);
      const data = buf.buffer.slice(
        buf.byteOffset,
        buf.byteOffset + buf.byteLength,
      );

      const reference = await loadAssetBundle(data.slice(0));
      const texture = reference.objects.find(
        (o) => o.type === AssetType.Texture2D,
      ) as unknown as {
        width: number;
        height: number;
        image: { data: Uint8Array };
      };
      const expected = flipAtlasYWithOutputBuffer(
        new Uint8ClampedArray(texture.image.data),
        texture.width,
        texture.height,
      );

      const tracker = trackClampedAllocations();
      let core;
      try {
        core = await parseBundleCore(data.slice(0), "ppets_306.bundle");
      } finally {
        tracker.restore();
      }

      const atlasBytes = core.atlasWidth * core.atlasHeight * 4;
      expect(core.atlasPixels!.rgba.byteLength).toBe(atlasBytes);
      expect(core.atlasPixels!.rgba.byteOffset).toBe(0);
      expect(core.atlasPixels!.rgba.buffer.byteLength).toBe(atlasBytes);
      expect(Array.from(core.atlasPixels!.rgba.subarray(0, 4096))).toEqual(
        Array.from(expected.subarray(0, 4096)),
      );
      expect(
        Array.from(core.atlasPixels!.rgba.subarray(atlasBytes - 4096)),
      ).toEqual(Array.from(expected.subarray(atlasBytes - 4096)));

      // 条带解码：整图级分配只允许输出这一份；其余都必须是条带级小分配
      // （RGBA32 直出路径则完全不分配）
      const fullSize = tracker.sizes.filter((size) => size >= atlasBytes);
      expect(fullSize.length, "整图级分配至多一份（解码输出）").toBeLessThanOrEqual(1);
    },
  );
});

describe("flipAtlasY", () => {
  it("still returns a new buffer for callers that keep the source", () => {
    const width = 5;
    const height = 4;
    const source = randomAtlas(width, height, 23);
    const snapshot = Array.from(source);

    const flipped = flipAtlasY(source, width, height);

    expect(flipped).not.toBe(source);
    expect(Array.from(source)).toEqual(snapshot);
    expect(Array.from(flipped)).toEqual(
      Array.from(flipAtlasYWithOutputBuffer(source, width, height)),
    );
  });
});
