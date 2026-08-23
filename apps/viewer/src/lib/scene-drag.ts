/**
 * 战斗布局场景拖拽的启动判定。
 *
 * 场景元素在 pointerdown 时会 setPointerCapture；指针一旦被捕获，
 * pointerup/click 会重定向到场景元素本身，工具条按钮将收不到 click。
 * 因此来自工具条（.scene-tools）内部的按下不得启动拖拽与捕获。
 */
export interface SceneDragPointerEvent {
  button: number;
  pointerType: string;
  target: EventTarget | null;
}

export function shouldStartSceneDrag(e: SceneDragPointerEvent): boolean {
  if (e.button !== 0 && e.pointerType === "mouse") return false;
  const target = e.target as HTMLElement | null;
  if (target?.closest?.(".scene-tools")) return false;
  return true;
}
