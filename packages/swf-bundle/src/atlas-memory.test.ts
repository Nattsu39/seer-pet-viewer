import { describe, expect, it } from "vitest";
import {
  bleedAtlasEdges,
  flipAtlasYInPlace,
  prepareAtlasRgba,
  zeroTransparentRgb,
} from "./atlas.js";

/**
 * 8192 图集内存对照测量（默认跳过，因为要分配 GiB 级 buffer 并跑满整图循环）。
 *
 *   SWF_ATLAS_MEMORY=1 pnpm --filter @seer/swf-bundle exec vitest run src/atlas-memory.test.ts
 *   SWF_ATLAS_MEMORY=1 SWF_ATLAS_MEMORY_SIZE=2048 ...   # 快速版
 *
 * 对照的是优化之前的图集链路：整图复制 → 整图翻转输出 → 整图 bleed scratch → ImageData 副本。
 */

const enabled = process.env.SWF_ATLAS_MEMORY === "1";
const side = Number(process.env.SWF_ATLAS_MEMORY_SIZE ?? 8192);
const MIB = 1024 * 1024;

/** 之前：整图输出 buffer */
function legacyFlipAtlasY(
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

/** 之前：整图 scratch + 多轮 pass */
function legacyBleedAtlasEdges(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  passes = 2,
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

/** 模拟 unity-js 解码结果：一半透明 padding，一半不透明内容 */
function decodedAtlas(width: number, height: number): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const opaque = y % 4 !== 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = (x * 7) & 0xff;
      data[i + 1] = (y * 5) & 0xff;
      data[i + 2] = (x + y) & 0xff;
      data[i + 3] = opaque && x % 3 !== 0 ? 255 : 0;
    }
  }
  return data;
}

function arrayBuffersMiB(): number {
  return process.memoryUsage().arrayBuffers / MIB;
}

interface Measurement {
  label: string;
  baselineMiB: number;
  peakMiB: number;
  deltaMiB: number;
  elapsedMs: number;
}

/**
 * 每次测量前尽量把上一轮的 buffer 还给系统。
 * 用 `NODE_OPTIONS=--expose-gc` 运行时结果最干净，否则 baseline 可能偏高。
 */
function measure(label: string, run: () => void): Measurement {
  (globalThis as { gc?: () => void }).gc?.();
  const before = arrayBuffersMiB();
  const start = performance.now();
  let peak = before;
  const sample = (): void => {
    peak = Math.max(peak, arrayBuffersMiB());
  };
  const timer = setInterval(sample, 5);
  try {
    run();
    sample();
  } finally {
    clearInterval(timer);
  }
  return {
    label,
    baselineMiB: Math.round(before),
    peakMiB: Math.round(peak),
    deltaMiB: Math.round(peak - before),
    elapsedMs: Math.round(performance.now() - start),
  };
}

describe.skipIf(!enabled)(`atlas ${side}×${side} memory profile`, () => {
  it("keeps only one full-size atlas buffer alive through the whole chain", () => {
    const atlasMiB = (side * side * 4) / MIB;
    const results: Measurement[] = [];

    // 之后：解码 buffer 上零拷贝视图 + 就地翻转 + 就地 bleed + 零拷贝 ImageData
    results.push(
      measure("p1", () => {
        const decoded = decodedAtlas(side, side);
        const rgba = new Uint8ClampedArray(
          decoded.buffer,
          decoded.byteOffset,
          decoded.byteLength,
        );
        flipAtlasYInPlace(rgba, side, side);
        prepareAtlasRgba(rgba, side, side);
        expect(rgba.buffer).toBe(decoded.buffer);
      }),
    );

    // 之前：解码 buffer + 副本 + 翻转输出 + bleed scratch + ImageData 副本
    results.push(
      measure("legacy", () => {
        const decoded = decodedAtlas(side, side);
        const copy = new Uint8ClampedArray(decoded);
        const flipped = legacyFlipAtlasY(copy, side, side);
        zeroTransparentRgb(flipped);
        legacyBleedAtlasEdges(flipped, side, side, 2);
        // ImageData(new Uint8ClampedArray(rgba))：位图化前的最后一份整图副本
        const imageDataCopy = new Uint8ClampedArray(flipped);
        expect(imageDataCopy.length).toBe(decoded.length);
      }),
    );

    const rows = results
      .map(
        (r) =>
          `${r.label.padEnd(7)} peak=${String(r.peakMiB).padStart(5)} MiB  baseline=${String(r.baselineMiB).padStart(5)} MiB  delta=${String(r.deltaMiB).padStart(5)} MiB  elapsed=${String(r.elapsedMs).padStart(6)} ms`,
      )
      .join("\n");
    console.log(`\natlas ${side}×${side}（单份 ${atlasMiB} MiB）\n${rows}\n`);

    const p1 = results[0]!;
    const legacy = results[1]!;
    // 新链路的整图峰值必须落在"一份图集 + 少量零头"以内
    expect(p1.deltaMiB).toBeLessThan(atlasMiB * 1.5);
    // 旧链路至少多出一份整图
    expect(legacy.deltaMiB).toBeGreaterThan(p1.deltaMiB + atlasMiB * 0.8);
    expect(bleedAtlasEdges).toBeTypeOf("function");
  }, 900_000);
});
