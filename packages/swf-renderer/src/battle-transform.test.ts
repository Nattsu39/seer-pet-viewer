import { describe, expect, it } from "vitest";
import { computeSwfBattleExportRootTransform } from "./battle-transform.js";
import type { BattleViewportLayout } from "@seer/anim-export/capture";

const LAYOUT: BattleViewportLayout = {
  width: 542,
  height: 782,
  originX: 151,
  originY: 391,
  pixelsPerUnitX: -37.5,
  pixelsPerUnitY: 37.5,
};

describe("computeSwfBattleExportRootTransform", () => {
  it("y 翻转到 GL 纹理坐标：height - originY，x 与缩放原样保留", () => {
    const t = computeSwfBattleExportRootTransform(LAYOUT);
    expect(t.x).toBe(151);
    expect(t.y).toBe(782 - 391);
    expect(t.scaleX).toBe(-37.5);
    expect(t.scaleY).toBe(37.5);
  });

  it("原点在画布正中时 y 恰为半高", () => {
    const t = computeSwfBattleExportRootTransform({
      ...LAYOUT,
      originX: 271,
      originY: 391,
    });
    expect(t.y).toBeCloseTo(782 / 2);
  });
});
