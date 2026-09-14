import { expect, it, vi } from "vitest";
import { SpinePlayer } from "./player.js";
import { computeSpineNativePixelsPerUnit } from "./export-dimensions.js";

it.each([0.01, 0.02, 1])("restores source pixel dimensions after loading skeleton scale %s", (scale) => {
  const sourceWidth = 320;
  expect(sourceWidth * scale * computeSpineNativePixelsPerUnit(scale)).toBeCloseTo(sourceWidth);
});

vi.mock("@seer-pet-anim/spine-bundle", () => ({
  SPINE_PREVIEW_FPS: 30,
  parseAtlasUsesPma: vi.fn(),
}));

it("uses exact export pixel density for differently sized sequences", () => {
  const camera = { zoom: 0, position: { x: 0, y: 0 }, update: vi.fn() };
  const player = Object.create(SpinePlayer.prototype) as any;
  player.renderer = { camera };
  for (const pixelsPerUnit of [3.26, 6.52, 9.78]) {
    for (const bounds of [
      { minX: -13, minY: -27, maxX: 100, maxY: 200 },
      { minX: -200, minY: -31, maxX: 777, maxY: 315 },
    ]) {
      player.applyExportCamera(bounds, pixelsPerUnit);
      expect(camera.zoom).toBe(1 / pixelsPerUnit);
      expect(camera.position.x).toBe((bounds.minX + bounds.maxX) / 2);
      expect(camera.position.y).toBe((bounds.minY + bounds.maxY) / 2);
    }
  }
});
