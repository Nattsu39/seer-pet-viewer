import { describe, expect, it } from "vitest";
import { DEFAULT_BATTLE_PX_PER_UNIT } from "@seer/battle-layout";
import { MAX_EXPORT_SIDE } from "./export-dimensions.js";
import { planBattleViewportExport } from "./battle-viewport.js";

// ppu=30 → 37.5 px/单位；左锚点 x=960-4×30=840、右锚点 x=1080，锚点 y=540

describe("planBattleViewportExport", () => {
  it("左侧默认布局：固定 1920×1080 设计帧，锚点像素位置恒定", () => {
    const layout = planBattleViewportExport({ side: "left" }, 1);
    expect(layout.width).toBe(1920);
    expect(layout.height).toBe(1080);
    expect(layout.originX).toBeCloseTo(840);
    expect(layout.originY).toBeCloseTo(540);
    expect(layout.pixelsPerUnitX).toBeCloseTo(37.5);
    expect(layout.pixelsPerUnitY).toBeCloseTo(37.5);
  });

  it("右侧镜像：同画布，锚点与左侧对称，pixelsPerUnitX 为负", () => {
    const layout = planBattleViewportExport({ side: "right" }, 1);
    expect(layout.width).toBe(1920);
    expect(layout.height).toBe(1080);
    expect(layout.originX).toBeCloseTo(1080);
    expect(layout.originY).toBeCloseTo(540);
    expect(layout.pixelsPerUnitX).toBeCloseTo(-37.5);
    expect(layout.pixelsPerUnitY).toBeCloseTo(37.5);
  });

  it("containerWorldY 抬升锚点：画布尺寸不变", () => {
    const layout = planBattleViewportExport(
      { side: "left", pxPerUnit: 30, containerWorldY: 2 },
      1,
    );
    expect(layout.width).toBe(1920);
    expect(layout.height).toBe(1080);
    expect(layout.originY).toBeCloseTo(540 - 2 * 30);
  });

  it("画布尺寸与布局参数无关：改 pxPerUnit/锚点偏移只动锚点与密度", () => {
    const a = planBattleViewportExport({ side: "left" }, 1);
    const b = planBattleViewportExport(
      { side: "left", pxPerUnit: 60, containerWorldY: 3 },
      1,
    );
    // 尺寸不随布局参数变化，只有锚点/密度变
    expect(b.width).toBe(a.width);
    expect(b.height).toBe(a.height);
  });

  it("用户倍率使整帧超过 MAX_EXPORT_SIDE 时等比钳回，输出与 1× 一致", () => {
    const layout = planBattleViewportExport({ side: "left" }, 3);
    expect(Math.max(layout.width, layout.height)).toBeLessThanOrEqual(
      MAX_EXPORT_SIDE,
    );
    expect(layout.width).toBe(1920);
    expect(layout.height).toBe(1080);
    expect(layout.pixelsPerUnitX).toBeCloseTo(37.5);
    expect(layout.originX).toBeCloseTo(840);
  });

  it("maxSide 放宽后倍率生效：2× → 3840×2160，锚点与密度同倍放大", () => {
    const layout = planBattleViewportExport({ side: "left" }, 2, 4096);
    expect(layout.width).toBe(3840);
    expect(layout.height).toBe(2160);
    expect(layout.pixelsPerUnitX).toBeCloseTo(75);
    expect(layout.pixelsPerUnitY).toBeCloseTo(75);
    expect(layout.originX).toBeCloseTo(1680);
    expect(layout.originY).toBeCloseTo(1080);
  });

  it("默认使用未校准的内置单位像素比", () => {
    const layout = planBattleViewportExport({ side: "left" }, 1);
    expect(layout.pixelsPerUnitY).toBeCloseTo(
      1.25 * DEFAULT_BATTLE_PX_PER_UNIT,
    );
  });
});
