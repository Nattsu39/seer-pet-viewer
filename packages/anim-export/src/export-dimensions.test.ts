import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BASE_EXPORT_CANVAS,
  EXPORT_PADDING,
  MAX_EXPORT_SIDE,
  computeReferenceScale,
  computeVertexCanvasSize,
  fitCanvas,
  planReferenceExport,
  resolveReferenceSequence,
} from "./export-dimensions.js";

describe("export-dimensions", () => {
  it("resolveReferenceSequence prefers standby then await", () => {
    expect(resolveReferenceSequence(["attack", "standby", "await"])).toBe(
      "standby",
    );
    expect(resolveReferenceSequence(["attack", "await"])).toBe("await");
    expect(resolveReferenceSequence(["attack", "sa"])).toBe("attack");
  });

  it("computeReferenceScale uses max span and base canvas padding", () => {
    const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 200 };
    const scale = computeReferenceScale(bounds);
    expect(scale).toBeCloseTo((BASE_EXPORT_CANVAS - EXPORT_PADDING * 2) / 200);
  });

  it("fitCanvas shrinks longest side and scales proportionally", () => {
    const fitted = fitCanvas(3000, 1500, 2.5, 1920);
    expect(Math.max(fitted.width, fitted.height)).toBe(1920);
    expect(fitted.scale).toBeCloseTo(2.5 * (1920 / 3000));
    expect(fitted.width).toBe(1920);
    expect(fitted.height).toBe(960);
  });

  it("planReferenceExport applies user scale then max side cap", () => {
    const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    const refScale = computeReferenceScale(bounds);
    const at1x = planReferenceExport(bounds, refScale, 1);
    expect(Math.max(at1x.width, at1x.height)).toBeLessThanOrEqual(
      MAX_EXPORT_SIDE,
    );

    const at3x = planReferenceExport(bounds, refScale, 3);
    expect(Math.max(at3x.width, at3x.height)).toBe(MAX_EXPORT_SIDE);
    expect(at3x.scale).toBeLessThan(refScale * 3);
  });

  it("computeVertexCanvasSize matches pet_export viewport formula", () => {
    const bounds = { minX: 10, minY: 20, maxX: 110, maxY: 220 };
    const scale = 3.5;
    const { width, height } = computeVertexCanvasSize(bounds, scale);
    expect(width).toBe(Math.ceil(100 * scale) + EXPORT_PADDING * 2);
    expect(height).toBe(Math.ceil(200 * scale) + EXPORT_PADDING * 2);
  });
});

const exampleDir = resolve(
  import.meta.dirname,
  "../../../examples/ppets_70.swfclip",
);

function sequenceVertexBounds(seq: {
  frames: { positions: number[] }[];
}): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const frame of seq.frames) {
    const pos = frame.positions;
    for (let i = 0; i < pos.length; i += 2) {
      minX = Math.min(minX, pos[i]!);
      maxX = Math.max(maxX, pos[i]!);
      minY = Math.min(minY, pos[i + 1]!);
      maxY = Math.max(maxY, pos[i + 1]!);
    }
  }
  return { minX, minY, maxX, maxY };
}

describe("ppets_70 export dimensions", () => {
  it("standby layout aligns with pet_export.py reference scale at 1x", () => {
    const meta = JSON.parse(
      readFileSync(resolve(exampleDir, "meta.json"), "utf-8"),
    );
    const standby = meta.sequences.find((s: { name: string }) => s.name === "standby");
    expect(standby).toBeDefined();

    const refBounds = sequenceVertexBounds(standby);
    const refScale = computeReferenceScale(refBounds);
    const layout = planReferenceExport(refBounds, refScale, 1);

    expect(layout.width).toBe(381);
    expect(layout.height).toBe(768);
    expect(layout.scale).toBeCloseTo(326.075, 2);

    const at3x = planReferenceExport(refBounds, refScale, 3);
    expect(Math.max(at3x.width, at3x.height)).toBe(MAX_EXPORT_SIDE);
  });

  it("attack uses standby reference scale with its own bounds", () => {
    const meta = JSON.parse(
      readFileSync(resolve(exampleDir, "meta.json"), "utf-8"),
    );
    const standby = meta.sequences.find((s: { name: string }) => s.name === "standby");
    const attack = meta.sequences.find((s: { name: string }) => s.name === "attack");
    expect(standby).toBeDefined();
    expect(attack).toBeDefined();

    const refScale = computeReferenceScale(sequenceVertexBounds(standby));
    const standbyLayout = planReferenceExport(
      sequenceVertexBounds(standby),
      refScale,
      1,
    );
    const attackLayout = planReferenceExport(
      sequenceVertexBounds(attack),
      refScale,
      1,
    );

    expect(standbyLayout.scale).toBeCloseTo(refScale);
    expect(attackLayout.width).toBe(1920);
    expect(attackLayout.height).toBe(791);
    expect(attackLayout.scale).toBeCloseTo(258.704, 2);
    expect(
      attackLayout.width !== standbyLayout.width ||
        attackLayout.height !== standbyLayout.height,
    ).toBe(true);
  });
});
