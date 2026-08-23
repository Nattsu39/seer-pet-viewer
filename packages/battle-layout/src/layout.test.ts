import { describe, expect, it } from "vitest";
import {
  battleSpaceVertexBounds,
  computeBattlePetPlacement,
  fitBattleCanvas,
  projectBattlePlacement,
} from "./layout.js";

describe("computeBattlePetPlacement", () => {
  it("左侧默认布局：锚点向左偏移，不镜像", () => {
    const placement = computeBattlePetPlacement("left", { pxPerUnit: 30 });
    expect(placement.position).toEqual({ x: 960 - 120, y: 540 });
    expect(placement.pixelsPerUnitX).toBe(1.25 * 30);
    expect(placement.pixelsPerUnitY).toBe(1.25 * 30);
  });

  it("右侧布局：锚点向右偏移且 x 镜像", () => {
    const placement = computeBattlePetPlacement("right", { pxPerUnit: 30 });
    expect(placement.position).toEqual({ x: 960 + 120, y: 540 });
    expect(placement.pixelsPerUnitX).toBe(-1.25 * 30);
    expect(placement.pixelsPerUnitY).toBe(1.25 * 30);
  });

  it("containerWorldY 沿设计稿 y 向下方向抬升锚点", () => {
    const placement = computeBattlePetPlacement("left", {
      pxPerUnit: 30,
      containerWorldY: 2,
    });
    expect(placement.position.y).toBe(540 - 60);
  });

  it("省略选项时使用内置默认（未校准 pxPerUnit=30、容器 y=0）", () => {
    const placement = computeBattlePetPlacement("left");
    expect(placement.position).toEqual({ x: 960 - 4 * 30, y: 540 });
    expect(placement.pixelsPerUnitX).toBeCloseTo(37.5);
  });

  it("pxPerUnit 非正数抛错", () => {
    expect(() => computeBattlePetPlacement("left", { pxPerUnit: 0 })).toThrow(
      RangeError,
    );
    expect(() =>
      computeBattlePetPlacement("left", { pxPerUnit: Number.NaN }),
    ).toThrow(RangeError);
  });
});

describe("fitBattleCanvas / projectBattlePlacement", () => {
  it("同比例画布：铺满且无偏移", () => {
    const fit = fitBattleCanvas(960, 540);
    expect(fit.scale).toBeCloseTo(0.5);
    expect(fit.offsetX).toBeCloseTo(0);
    expect(fit.offsetY).toBeCloseTo(0);
  });

  it("更宽的画布：按高度适配并水平居中", () => {
    const fit = fitBattleCanvas(1920, 540);
    expect(fit.scale).toBeCloseTo(0.5);
    expect(fit.offsetX).toBeCloseTo(480);
    expect(fit.offsetY).toBeCloseTo(0);
  });

  it("投影缩放位置与像素密度", () => {
    const placement = computeBattlePetPlacement("left", { pxPerUnit: 30 });
    const projected = projectBattlePlacement(placement, {
      scale: 0.5,
      offsetX: 100,
      offsetY: 20,
    });
    expect(projected.position.x).toBeCloseTo(100 + (960 - 120) * 0.5);
    expect(projected.position.y).toBeCloseTo(20 + 540 * 0.5);
    expect(projected.pixelsPerUnitX).toBeCloseTo(37.5 * 0.5);
    expect(projected.pixelsPerUnitY).toBeCloseTo(37.5 * 0.5);
  });
});

describe("battleSpaceVertexBounds", () => {
  const bounds = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

  it("无镜像：内容 +x 向右、+y 向上", () => {
    const placement = computeBattlePetPlacement("left", { pxPerUnit: 30 });
    const space = battleSpaceVertexBounds(placement, bounds);
    expect(space.minX).toBeCloseTo(960 - 120);
    expect(space.maxX).toBeCloseTo(960 - 120 + 10 * 37.5);
    expect(space.maxY).toBeCloseTo(540);
    expect(space.minY).toBeCloseTo(540 - 10 * 37.5);
  });

  it("镜像：内容 +x 向左", () => {
    const placement = computeBattlePetPlacement("right", { pxPerUnit: 30 });
    const space = battleSpaceVertexBounds(placement, bounds);
    expect(space.maxX).toBeCloseTo(960 + 120);
    expect(space.minX).toBeCloseTo(960 + 120 - 10 * 37.5);
    expect(space.minY).toBeCloseTo(540 - 10 * 37.5);
    expect(space.maxY).toBeCloseTo(540);
  });

  it("负坐标内容包围盒同样映射", () => {
    const placement = computeBattlePetPlacement("left", { pxPerUnit: 30 });
    const space = battleSpaceVertexBounds(placement, {
      minX: -5,
      minY: -2,
      maxX: 5,
      maxY: 8,
    });
    expect(space.minX).toBeCloseTo(840 - 5 * 37.5);
    expect(space.maxX).toBeCloseTo(840 + 5 * 37.5);
    expect(space.minY).toBeCloseTo(540 - 8 * 37.5);
    expect(space.maxY).toBeCloseTo(540 + 2 * 37.5);
  });
});
