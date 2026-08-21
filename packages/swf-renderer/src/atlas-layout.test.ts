import { describe, expect, it, vi } from "vitest";
import { planAtlasTileGrid } from "@seer/swf-bundle";
import {
  releaseAtlasLayoutPixels,
  type AtlasUploader,
  type SwfAtlasLayout,
} from "./atlas-layout.js";

describe("atlas layout planning", () => {
  it("does not tile ppets_70-sized atlases at 4096", () => {
    expect(planAtlasTileGrid(2048, 1024, 4096)).toBeNull();
  });

  it("tiles ppets_4911-sized atlases at 4096 into 2x2", () => {
    const plan = planAtlasTileGrid(8192, 8192, 4096)!;
    expect(plan.tiles).toHaveLength(4);
    expect(plan.logicalWidth).toBe(8192);
    expect(plan.logicalHeight).toBe(8192);
    for (const tile of plan.tiles) {
      expect(tile.width).toBeLessThanOrEqual(4096);
      expect(tile.height).toBeLessThanOrEqual(4096);
    }
  });
});

interface FakeSource {
  autoGarbageCollect: boolean;
}

interface FakeBitmap {
  width: number;
  height: number;
  close: ReturnType<typeof vi.fn>;
}

function fakeLayout(
  tileCount: number,
  onClose?: () => void,
): {
  layout: SwfAtlasLayout;
  bitmaps: FakeBitmap[];
  sources: FakeSource[];
} {
  const bitmaps: FakeBitmap[] = [];
  const sources: FakeSource[] = [];
  const tiles = Array.from({ length: tileCount }, (_, index) => {
    const source: FakeSource = { autoGarbageCollect: true };
    const bitmap = {
      width: 4096,
      height: 4096,
    } as FakeBitmap;
    bitmap.close = vi.fn(() => {
      onClose?.();
      bitmap.width = 0;
      bitmap.height = 0;
    });
    sources.push(source);
    bitmaps.push(bitmap);
    return {
      tile: {
        index,
        col: index,
        row: 0,
        x: index * 4096,
        y: 0,
        width: 4096,
        height: 4096,
      },
      bitmap,
      texture: { source },
    };
  });

  return {
    layout: {
      plan: null,
      split: tileCount > 1,
      tiles,
    } as unknown as SwfAtlasLayout,
    bitmaps,
    sources,
  };
}

describe("releaseAtlasLayoutPixels", () => {
  it("uploads every tile before closing its CPU bitmap", () => {
    const steps: string[] = [];
    const { layout, bitmaps, sources } = fakeLayout(4, () =>
      steps.push("close"),
    );
    const initSource = vi.fn(() => steps.push("upload"));

    const released = releaseAtlasLayoutPixels(
      { texture: { initSource } } as unknown as AtlasUploader,
      layout,
    );

    expect(released).toBe(true);
    expect(initSource).toHaveBeenCalledTimes(4);
    expect(steps).toEqual([
      "upload",
      "upload",
      "upload",
      "upload",
      "close",
      "close",
      "close",
      "close",
    ]);
    for (const bitmap of bitmaps) {
      expect(bitmap.width).toBe(0);
    }
    // CPU 像素已释放，绝不能再让 GC 卸载纹理后尝试重新上传
    for (const source of sources) {
      expect(source.autoGarbageCollect).toBe(false);
    }
  });

  it("keeps the CPU bitmap when the renderer cannot force an upload", () => {
    const { layout, bitmaps, sources } = fakeLayout(2);

    const released = releaseAtlasLayoutPixels(
      { texture: {} } as unknown as AtlasUploader,
      layout,
    );

    expect(released).toBe(false);
    for (const bitmap of bitmaps) {
      expect(bitmap.close).not.toHaveBeenCalled();
      expect(bitmap.width).toBe(4096);
    }
    for (const source of sources) {
      expect(source.autoGarbageCollect).toBe(true);
    }
  });

  it("skips bitmaps that were already closed and tolerates a missing layout", () => {
    const { layout, bitmaps } = fakeLayout(2);
    bitmaps[0]!.width = 0;
    bitmaps[0]!.height = 0;
    const initSource = vi.fn();
    const uploader = { texture: { initSource } } as unknown as AtlasUploader;

    expect(releaseAtlasLayoutPixels(uploader, null)).toBe(false);
    expect(initSource).not.toHaveBeenCalled();

    expect(releaseAtlasLayoutPixels(uploader, layout)).toBe(true);
    expect(bitmaps[0]!.close).not.toHaveBeenCalled();
    expect(bitmaps[1]!.close).toHaveBeenCalledTimes(1);
  });
});
