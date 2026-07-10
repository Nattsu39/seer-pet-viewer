import {
  appendAtlasTileWarning,
  filterAtlasTileWarnings,
  getMaxTextureSize,
} from "@seer/swf-bundle";

/** 与 SwfPlayer mount 一致：DEV 下可用 ?swfMaxTextureSize= 覆盖 */
export function getEffectiveSwfMaxTextureSize(): number {
  if (import.meta.env.DEV) {
    const raw = new URLSearchParams(window.location.search).get(
      "swfMaxTextureSize",
    );
    if (raw) {
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return getMaxTextureSize();
}

/** 按当前运行时纹理上限附加图集分块提示（仅当确实需要分块时） */
export function withRuntimeAtlasTileWarning(
  warnings: string[],
  atlasWidth: number,
  atlasHeight: number,
): string[] {
  const base = filterAtlasTileWarnings(warnings);
  return appendAtlasTileWarning(
    base,
    atlasWidth,
    atlasHeight,
    getEffectiveSwfMaxTextureSize(),
  );
}
