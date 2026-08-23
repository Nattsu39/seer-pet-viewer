import { describe, expect, it } from "vitest";
import {
  computeSpineBattleExportCamera,
  computeSpineFixedCamera,
} from "./battle-camera.js";
import type { BattleViewportLayout } from "@seer/anim-export/capture";

describe("computeSpineFixedCamera", () => {
  it("原点在画布中心时相机中心为世界原点", () => {
    const params = computeSpineFixedCamera(
      { position: { x: 960, y: 540 }, scale: { x: 37.5, y: -37.5 } },
      1920,
      1080,
    );
    expect(params.zoom).toBeCloseTo(1 / 37.5);
    expect(params.x).toBeCloseTo(0);
    expect(params.y).toBeCloseTo(0);
  });

  it("原点偏移按 zoom 换算相机中心（y 向上取反）", () => {
    const params = computeSpineFixedCamera(
      { position: { x: 840, y: 640 }, scale: { x: 37.5, y: -37.5 } },
      1920,
      1080,
    );
    const zoom = 1 / 37.5;
    expect(params.x).toBeCloseTo(120 * zoom);
    // position.y 向下越过中心 → 相机中心 y 为正（世界向上）
    expect(params.y).toBeCloseTo(100 * zoom);
  });

  it("负 scale.x 时 zoom 取幅值", () => {
    const params = computeSpineFixedCamera(
      { position: { x: 1080, y: 540 }, scale: { x: -37.5, y: -37.5 } },
      1920,
      1080,
    );
    expect(params.zoom).toBeCloseTo(1 / 37.5);
    expect(params.x).toBeCloseTo(-120 / 37.5);
  });

  it("pixelRatio=2 时 zoom 与坐标按 backing 像素换算（内容不因 dpr 缩小）", () => {
    const params = computeSpineFixedCamera(
      { position: { x: 840, y: 640 }, scale: { x: 37.5, y: -37.5 } },
      3840,
      2160,
      2,
    );
    expect(params.zoom).toBeCloseTo(1 / 75);
    // 原点 backing 像素 = (840·2, 640·2)，相机中心 = (画布中心 − 原点)·zoom
    expect(params.x).toBeCloseTo((1920 - 1680) / 75);
    expect(params.y).toBeCloseTo((1280 - 1080) / 75);
  });
});

describe("computeSpineBattleExportCamera", () => {
  const layout: BattleViewportLayout = {
    width: 542,
    height: 782,
    originX: 151,
    originY: 391,
    pixelsPerUnitX: 37.5,
    pixelsPerUnitY: 37.5,
  };

  it("原点在画布中心时相机中心为世界原点", () => {
    const params = computeSpineBattleExportCamera({
      ...layout,
      originX: 271,
      originY: 391,
    });
    expect(params.zoom).toBeCloseTo(1 / 37.5);
    expect(params.x).toBeCloseTo(0);
    expect(params.y).toBeCloseTo(0);
  });

  it("镜像布局按 origin 定位（zoom 取 pixelsPerUnitX 幅值）", () => {
    const params = computeSpineBattleExportCamera({
      ...layout,
      originX: 391,
      pixelsPerUnitX: -37.5,
    });
    expect(params.zoom).toBeCloseTo(1 / 37.5);
    expect(params.x).toBeCloseTo((271 - 391) / 37.5);
    expect(params.y).toBeCloseTo(0);
  });
});
