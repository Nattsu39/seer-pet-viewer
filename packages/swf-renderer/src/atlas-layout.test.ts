import { describe, expect, it } from "vitest";
import { planAtlasTileGrid } from "@seer/swf-bundle";

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
