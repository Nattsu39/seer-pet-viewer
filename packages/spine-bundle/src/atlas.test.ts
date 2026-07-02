import { describe, expect, it } from "vitest";
import {
  clampPmaRgb,
  parseAtlasUsesPma,
  prepareSpineAtlasRgba,
  zeroTransparentRgb,
} from "./atlas.js";

describe("parseAtlasUsesPma", () => {
  it("reads pma:true from atlas page", () => {
    expect(parseAtlasUsesPma("4000.png\nsize:1,1\npma:true\n")).toBe(true);
  });

  it("reads pma:false", () => {
    expect(parseAtlasUsesPma("x.png\npma:false\n")).toBe(false);
  });

  it("defaults to true when absent", () => {
    expect(parseAtlasUsesPma("x.png\nsize:1,1\n")).toBe(true);
  });
});

describe("prepareSpineAtlasRgba", () => {
  it("clears dirty rgb in fully transparent pixels", () => {
    const rgba = new Uint8ClampedArray([255, 0, 0, 0]);
    prepareSpineAtlasRgba(rgba, 1, 1, true);
    expect(Array.from(rgba)).toEqual([0, 0, 0, 0]);
  });

  it("clamps rgb to alpha for pma textures", () => {
    const rgba = new Uint8ClampedArray([200, 180, 160, 100]);
    clampPmaRgb(rgba);
    expect(Array.from(rgba)).toEqual([100, 100, 100, 100]);
  });

  it("does not bleed colored rgb into pma padding", () => {
    const rgba = new Uint8ClampedArray([
      255, 255, 255, 255, // opaque white
      0, 0, 0, 0, // transparent padding
    ]);
    prepareSpineAtlasRgba(rgba, 2, 1, true);
    expect(Array.from(rgba.slice(4, 8))).toEqual([0, 0, 0, 0]);
  });

  it("bleeds edges for straight-alpha atlases", () => {
    const rgba = new Uint8ClampedArray([
      255, 255, 255, 255,
      0, 0, 0, 0,
    ]);
    prepareSpineAtlasRgba(rgba, 2, 1, false);
    expect(Array.from(rgba.slice(4, 8))).toEqual([255, 255, 255, 0]);
  });

  it("zeroTransparentRgb only touches alpha=0", () => {
    const rgba = new Uint8ClampedArray([9, 8, 7, 0, 1, 2, 3, 4]);
    zeroTransparentRgb(rgba);
    expect(Array.from(rgba)).toEqual([0, 0, 0, 0, 1, 2, 3, 4]);
  });
});
