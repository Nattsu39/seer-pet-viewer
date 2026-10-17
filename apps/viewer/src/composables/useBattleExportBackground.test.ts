import { effectScope, nextTick, ref, type EffectScope } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ViewerExportFormat } from "./useAnimationExport";
import { useBattleExportBackground } from "./useBattleExportBackground";

const scopes: EffectScope[] = [];

function createBackground(format = ref<ViewerExportFormat>("webp")) {
  const scope = effectScope();
  scopes.push(scope);
  return scope.run(() => useBattleExportBackground(format))!;
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop());
  vi.restoreAllMocks();
});

it("persists independent battle settings and resets them to the defaults", async () => {
  const viewerSettings = JSON.stringify({ canvasBackgroundColor: "#abcdef" });
  localStorage.setItem("seer-viewer-settings", viewerSettings);
  const state = createBackground();
  expect(state.backgroundMode.value).toBe("transparent");
  expect(state.backgroundColor.value).toBe("#12121f");

  state.backgroundMode.value = "solid";
  state.backgroundColor.value = "#ff0000";
  await nextTick();
  const restored = createBackground();
  expect(restored.backgroundMode.value).toBe("solid");
  expect(restored.backgroundColorNumber.value).toBe(0xff0000);
  expect(localStorage.getItem("seer-viewer-settings")).toBe(viewerSettings);

  restored.resetBackground();
  await nextTick();
  const reset = createBackground();
  expect(reset.backgroundMode.value).toBe("transparent");
  expect(reset.backgroundColor.value).toBe("#12121f");
  expect(localStorage.getItem("seer-viewer-settings")).toBe(viewerSettings);
});

it.each(["webp", "gif", "png-sequence"] as const)(
  "temporarily uses a solid background for MP4 and restores %s transparency",
  async (otherFormat) => {
    const format = ref<ViewerExportFormat>(otherFormat);
    const state = createBackground(format);
    state.backgroundColor.value = "#123456";
    await nextTick();

    format.value = "mp4";
    expect(state.backgroundMode.value).toBe("solid");
    state.backgroundColor.value = "#abcdef";
    await nextTick();
    const restored = createBackground();
    expect(restored.backgroundMode.value).toBe("transparent");
    expect(restored.backgroundColor.value).toBe("#abcdef");

    format.value = otherFormat;
    expect(state.backgroundMode.value).toBe("transparent");
    expect(state.backgroundColorNumber.value).toBe(0xabcdef);
    state.backgroundMode.value = "solid";
    format.value = "mp4";
    format.value = otherFormat;
    expect(state.backgroundMode.value).toBe("solid");
  },
);

it("keeps MP4 solid after reset and restores transparency when switching away", async () => {
  const format = ref<ViewerExportFormat>("mp4");
  const state = createBackground(format);
  state.backgroundColor.value = "#ff0000";
  state.resetBackground();
  await nextTick();
  expect(state.backgroundMode.value).toBe("solid");
  expect(state.backgroundColorNumber.value).toBe(0x12121f);
  format.value = "webp";
  expect(state.backgroundMode.value).toBe("transparent");
});

it.each(["{", "null", '{"mode":"image","color":"invalid"}'])(
  "recovers from invalid stored settings: %s",
  (stored) => {
    localStorage.setItem("seer-battle-export-background", stored);
    const state = createBackground();
    expect(state.backgroundMode.value).toBe("transparent");
    expect(state.backgroundColorNumber.value).toBe(0x12121f);
  },
);

it("keeps background controls usable when storage is unavailable", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("Storage unavailable");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Storage unavailable");
  });
  const state = createBackground();
  state.backgroundMode.value = "solid";
  state.backgroundColor.value = "#123456";
  await nextTick();
  expect(state.backgroundMode.value).toBe("solid");
  expect(state.backgroundColorNumber.value).toBe(0x123456);
});
