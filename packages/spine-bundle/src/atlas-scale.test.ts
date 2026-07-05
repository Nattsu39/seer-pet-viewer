import { describe, expect, it } from "vitest";
import { scaleSpineAtlasText } from "./atlas-scale.js";

describe("scaleSpineAtlasText", () => {
  it("scales page size and region bounds", () => {
    const atlasText = [
      "4000.png",
      "size:2048,2048",
      "filter:Linear,Linear",
      "pma:true",
      "scale:0.3",
      "SG1",
      "bounds:812,112,31,31",
    ].join("\n");
    const scaled = scaleSpineAtlasText(
      atlasText,
      new Map([["4000.png", 0.5]]),
    );
    expect(scaled).toContain("size:1024,1024");
    expect(scaled).toContain("bounds:406,56,16,16");
    expect(scaled).toContain("scale:0.3");
  });

  it("leaves pages with scale 1 unchanged", () => {
    const atlasText = "page.png\nsize:512,512\nbounds:10,20,30,40\n";
    const scaled = scaleSpineAtlasText(
      atlasText,
      new Map([["page.png", 1]]),
    );
    expect(scaled).toBe(atlasText);
  });

  it("scales only the targeted atlas page in multi-page files", () => {
    const atlasText = [
      "a.png",
      "size:2048,2048",
      "r1",
      "bounds:100,100,10,10",
      "b.png",
      "size:1024,1024",
      "r2",
      "bounds:200,200,20,20",
    ].join("\n");
    const scaled = scaleSpineAtlasText(
      atlasText,
      new Map([
        ["a.png", 0.5],
        ["b.png", 1],
      ]),
    );
    expect(scaled).toContain("bounds:50,50,5,5");
    expect(scaled).toContain("bounds:200,200,20,20");
    expect(scaled).toContain("size:1024,1024");
  });

  it("scales offsets lines on regions", () => {
    const atlasText = [
      "page.png",
      "size:2048,2048",
      "wearsh_10",
      "bounds:10,20,30,40",
      "offsets:0,0,39,76",
    ].join("\n");
    const scaled = scaleSpineAtlasText(
      atlasText,
      new Map([["page.png", 0.5]]),
    );
    expect(scaled).toContain("offsets:0,0,20,38");
  });
});
