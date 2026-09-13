/** Flash Tools 默认导入像素密度；兼容未记录该字段的旧 swfclip 包。 */
export const DEFAULT_SWF_PIXELS_PER_UNIT = 100;

export function resolveSwfPixelsPerUnit(value?: number): number {
  const pixelsPerUnit = value ?? DEFAULT_SWF_PIXELS_PER_UNIT;
  if (!Number.isFinite(pixelsPerUnit) || pixelsPerUnit <= 0) {
    throw new Error("SWF 原始像素密度必须为有限正数");
  }
  return pixelsPerUnit;
}
