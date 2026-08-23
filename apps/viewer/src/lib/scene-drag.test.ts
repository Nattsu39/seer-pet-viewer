import { describe, expect, it } from "vitest";
import {
  shouldStartSceneDrag,
  type SceneDragPointerEvent,
} from "./scene-drag";

function pointerEvent(
  overrides: Partial<SceneDragPointerEvent> = {},
): SceneDragPointerEvent {
  return { button: 0, pointerType: "mouse", target: null, ...overrides };
}

function buildSceneDom(): {
  stage: HTMLElement;
  tools: HTMLElement;
  toolsButton: HTMLElement;
  stageChild: HTMLElement;
} {
  const stage = document.createElement("div");
  const stageChild = document.createElement("div");
  const tools = document.createElement("div");
  tools.className = "scene-tools";
  const toolsButton = document.createElement("button");
  tools.appendChild(toolsButton);
  stage.appendChild(stageChild);
  stage.appendChild(tools);
  return { stage, tools, toolsButton, stageChild };
}

describe("shouldStartSceneDrag（战斗布局场景拖拽守卫）", () => {
  it("场景空白处的鼠标左键按下可以开始拖拽", () => {
    const { stage } = buildSceneDom();
    expect(shouldStartSceneDrag(pointerEvent({ target: stage }))).toBe(true);
  });

  it("场景内非工具条元素上的左键按下可以开始拖拽", () => {
    const { stageChild } = buildSceneDom();
    expect(shouldStartSceneDrag(pointerEvent({ target: stageChild }))).toBe(
      true,
    );
  });

  it("鼠标右键不启动拖拽", () => {
    const { stage } = buildSceneDom();
    expect(
      shouldStartSceneDrag(pointerEvent({ target: stage, button: 2 })),
    ).toBe(false);
  });

  it("触摸/触笔的接触按下等同左键，可以拖拽", () => {
    const { stage } = buildSceneDom();
    expect(
      shouldStartSceneDrag(
        pointerEvent({ target: stage, pointerType: "touch" }),
      ),
    ).toBe(true);
  });

  it("工具条按钮上的按下不启动拖拽（否则 pointer capture 会吞掉按钮点击）", () => {
    const { toolsButton } = buildSceneDom();
    expect(shouldStartSceneDrag(pointerEvent({ target: toolsButton }))).toBe(
      false,
    );
  });

  it("工具条容器自身的按下同样不启动拖拽", () => {
    const { tools } = buildSceneDom();
    expect(shouldStartSceneDrag(pointerEvent({ target: tools }))).toBe(false);
  });

  it("target 缺失时按可拖拽处理（不因空目标报错）", () => {
    expect(shouldStartSceneDrag(pointerEvent({ target: null }))).toBe(true);
  });
});
