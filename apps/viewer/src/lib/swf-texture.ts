import {
  appendAtlasTileWarning,
  filterAtlasTileWarnings,
  getMaxTextureSize,
} from "@seer/swf-bundle";
import { useHighPrecisionAtlasSampling } from "@seer/swf-renderer";
import { isMobileViewport } from "../composables/useBreakpoint";
import { buildPetDeepLinkUrl } from "./pet-deep-link";
import type { ViewerWarning } from "./viewer-warning";

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

/** 移动端 + 大图集（>2048）时提示用户在电脑端打开当前动画链接 */
export function appendMobileLargeAtlasBlurWarning(
  warnings: ViewerWarning[],
  atlasWidth: number,
  atlasHeight: number,
  petId: number,
): ViewerWarning[] {
  if (typeof window === "undefined") return warnings;
  if (!isMobileViewport()) return warnings;
  if (useHighPrecisionAtlasSampling(atlasWidth, atlasHeight)) return warnings;

  return [
    ...warnings,
    {
      message: `在当前移动设备上，该动画的显示可能会很模糊。请使用电脑浏览器打开此链接：`,
      href: buildPetDeepLinkUrl(petId, { kind: "swf" }),
    },
  ];
}

export function withSwfRuntimeWarnings(
  warnings: string[],
  atlasWidth: number,
  atlasHeight: number,
  petId: number,
): ViewerWarning[] {
  return appendMobileLargeAtlasBlurWarning(
    withRuntimeAtlasTileWarning(warnings, atlasWidth, atlasHeight),
    atlasWidth,
    atlasHeight,
    petId,
  );
}
