import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appendAtlasTileWarning,
  filterAtlasTileWarnings,
  isAtlasTileWarning,
  loadSwfClipPackage,
  swfClipDataToJson,
} from "./clip-data.js";
import { atlasTileWarning } from "./max-texture-size.js";

afterEach(() => vi.unstubAllGlobals());

it.each([undefined, 200])("preserves original pixel density through package loading and saving (%s)", async (pixelsPerUnit) => {
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 32, height: 32 })));
  const meta = { petId: 70, name: "pet", frameRate: 24, atlasWidth: 32, atlasHeight: 32, pixelsPerUnit, materialWarnings: [], sequences: [] };
  const clip = await loadSwfClipPackage(meta, new Blob(), { atlasPrepared: true });
  expect(clip.pixelsPerUnit).toBe(pixelsPerUnit ?? 100);
  expect(swfClipDataToJson(clip).pixelsPerUnit).toBe(pixelsPerUnit ?? 100);
});

describe("appendAtlasTileWarning", () => {
  it("does not warn when atlas fits within the device limit", () => {
    expect(appendAtlasTileWarning([], 8192, 8192, 16384)).toEqual([]);
  });

  it("warns when atlas exceeds the device limit", () => {
    const warnings = appendAtlasTileWarning([], 8192, 8192, 4096);
    expect(warnings).toEqual([
      atlasTileWarning(8192, 8192, 4096),
    ]);
  });

  it("deduplicates identical tile warnings", () => {
    const first = appendAtlasTileWarning([], 8192, 8192, 4096);
    const second = appendAtlasTileWarning(first, 8192, 8192, 4096);
    expect(second).toBe(first);
  });
});

describe("filterAtlasTileWarnings", () => {
  it("removes persisted tile warnings while keeping other messages", () => {
    const tile = atlasTileWarning(8192, 8192, 4096);
    expect(isAtlasTileWarning(tile)).toBe(true);
    expect(
      filterAtlasTileWarnings([tile, "缺少共享材质"]),
    ).toEqual(["缺少共享材质"]);
  });
});
