import { describe, expect, it } from "vitest";
import {
  appendAtlasTileWarning,
  filterAtlasTileWarnings,
  isAtlasTileWarning,
} from "./clip-data.js";
import { atlasTileWarning } from "./max-texture-size.js";

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
